// server/index.js — Bun entry point. `bun run dev` builds the client then runs this
// with --hot.

import { app } from "./app.js";
import { dbPath, db } from "./db.js";
import { existsSync } from "node:fs";

const port = Number(process.env.PORT ?? 8788);

const generatedCss = "./src/styles/tailwind.css.js";
if (!existsSync(generatedCss)) {
  console.warn("! Tailwind stylesheet not generated — run `bun run css` (or `bun run build`).");
}
if (!existsSync("./client/vendor/lit.js")) {
  console.warn("! Lit bundle not vendored — run `bun run vendor` (or `bun run build`).");
}

const branchCount = db.query("select count(*) as c from branch").get().c;
// Explicit indexes only — UNIQUE columns get an implicit sqlite_autoindex with a null sql.
const indexCount = db
  .query("select count(*) as c from sqlite_master where type='index' and sql is not null")
  .get().c;

console.log(`rm-merchant-components  →  http://localhost:${port}`);
console.log(`  dataset  ${dbPath}`);
console.log(
  `  branches ${branchCount}   explicit indexes ${indexCount}` +
    (indexCount === 0 ? "  (none yet — see docs/plan.md §7.2)" : ""),
);

export default { port, fetch: app.fetch };
