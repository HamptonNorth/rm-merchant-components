// scripts/seal-dataset.js — make a generated dataset safe to serve from a read-only volume.
//
//   bun run scripts/seal-dataset.js [path]
//
// datagenerator2 leaves the dataset in WAL journal mode, which is right for the thing that
// writes it and wrong for everything that reads it afterwards. A WAL database needs to
// create a `-shm` sidecar **even for a readonly connection**, so serving one from a
// directory the process cannot write fails with:
//
//   SQLITE_READONLY_DIRECTORY: attempt to write a readonly database
//
// which is a confusing way to be told "your journal mode is wrong", because nothing is
// trying to write. That is exactly what the systemd unit does — ProtectSystem=strict makes
// /opt read-only, deliberately, since this app never writes.
//
// `journal_mode=delete` checkpoints any outstanding WAL content back into the main file and
// leaves one self-contained file with no sidecars. For a dataset that is generated once and
// read forever, WAL costs something and buys nothing.
//
// Idempotent: already-sealed datasets are reported and left alone.

import { Database } from "bun:sqlite";
import { existsSync, statSync, unlinkSync } from "node:fs";

const path = process.argv[2] ?? process.env.MERCHANT_DB_PATH;
if (!path) {
  console.error("usage: bun run scripts/seal-dataset.js <path-to.db>   (or set MERCHANT_DB_PATH)");
  process.exit(2);
}
if (!existsSync(path)) {
  console.error(`no dataset at ${path}`);
  process.exit(1);
}

// Opened read-write on purpose — the conversion is a write, and it is the only one this
// project ever performs on the dataset.
const db = new Database(path);
const before = db.query("pragma journal_mode").get().journal_mode;

if (before === "delete") {
  console.log(`    already sealed (journal_mode=${before})`);
} else {
  const wal = `${path}-wal`;
  const pending = existsSync(wal) ? statSync(wal).size : 0;
  db.exec("pragma journal_mode=delete");
  const after = db.query("pragma journal_mode").get().journal_mode;
  if (after !== "delete") {
    console.error(`    could not seal: journal_mode is still ${after}`);
    process.exit(1);
  }
  console.log(
    `    sealed ${before} -> ${after}` +
      (pending ? ` (checkpointed ${pending.toLocaleString("en-GB")} bytes of WAL)` : ""),
  );
}
db.close();

// -shm can survive the conversion and is pure noise afterwards; a stale one next to a
// non-WAL database is the kind of thing that gets investigated later for no reason.
for (const suffix of ["-wal", "-shm"]) {
  const side = `${path}${suffix}`;
  if (existsSync(side)) {
    unlinkSync(side);
    console.log(`    removed ${side.split("/").pop()}`);
  }
}

// Prove it: reopen exactly the way the server will. Sealing something that still cannot be
// served readonly would be worse than not sealing it, because the deploy would go green.
const check = new Database(path, { readonly: true });
const rows = check.query("select count(*) as c from product").get().c;
check.close();
console.log(`    verified readonly — ${rows.toLocaleString("en-GB")} products`);
