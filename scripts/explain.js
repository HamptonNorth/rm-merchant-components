// scripts/explain.js — measure a query, and test candidate indexes, without touching
// datagenerator.db or regenerating anything (docs/plan.md §7.4).
//
// The point is that only *proven* indexes get promoted upstream into datagenerator2's
// schema, so a regeneration cycle is never spent on a guess. Candidate indexes are
// applied to a scratch copy in /tmp, which is deleted on exit.
//
//   bun run explain --list
//   bun run explain branches.list
//   bun run explain --sql "select ... where customer_id = 12345"
//   bun run explain --sql "..." --index "create index ix on aged_debt(customer_id, transaction_date)"
//
// --index may be repeated. --runs sets the sample count (default 5).

import { Database } from "bun:sqlite";
import { copyFileSync, rmSync, existsSync } from "node:fs";
import { dbPath } from "../server/db.js";
import { benchmarks as branchBenchmarks } from "../server/queries/branches.js";

const REGISTERED = [...branchBenchmarks];

const argv = process.argv.slice(2);
const flag = (name) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}`) out.push(argv[++i]);
  return out;
};
const has = (name) => argv.includes(`--${name}`);

if (has("list")) {
  console.log("registered queries:");
  for (const b of REGISTERED) console.log(`  ${b.name}`);
  console.log("\nor pass raw SQL:  bun run explain --sql \"select ...\"");
  process.exit(0);
}

const rawSql = flag("sql")[0];
const named = argv.find((a) => !a.startsWith("--") && !flag("sql").includes(a) && !flag("index").includes(a) && !flag("runs").includes(a));

let target;
if (rawSql) {
  target = { name: "--sql", sql: rawSql, params: [] };
} else if (named) {
  target = REGISTERED.find((b) => b.name === named);
  if (!target) {
    console.error(`unknown query "${named}" — try --list`);
    process.exit(1);
  }
} else {
  console.error("usage: bun run explain <name> | --sql \"...\"  [--index \"create index ...\"]");
  process.exit(1);
}

const candidateIndexes = flag("index");
const runs = Number(flag("runs")[0] ?? 5);

const scratch = `/tmp/rm-explain-${process.pid}.db`;
copyFileSync(dbPath, scratch);
const cleanup = () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(scratch + suffix)) rmSync(scratch + suffix, { force: true });
  }
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

const db = new Database(scratch);

function sample(label) {
  db.query(target.sql).all(...target.params); // warm
  const started = performance.now();
  let rows = 0;
  for (let i = 0; i < runs; i++) rows = db.query(target.sql).all(...target.params).length;
  const ms = (performance.now() - started) / runs;
  const plan = db
    .query(`explain query plan ${target.sql}`)
    .all(...target.params)
    .map((r) => r.detail);
  console.log(`\n${label}`);
  console.log(`  ${ms.toFixed(2)} ms  (${runs}-run mean, ${rows} rows)`);
  for (const line of plan) {
    const slow = /\bSCAN\b/.test(line) || /TEMP B-TREE/.test(line);
    console.log(`  ${slow ? "!" : " "} ${line}`);
  }
  return ms;
}

console.log(`query    ${target.name}`);
console.log(`dataset  ${dbPath}`);
console.log(`scratch  ${scratch}`);

const before = sample(candidateIndexes.length ? "BEFORE" : "MEASURED");

if (candidateIndexes.length) {
  for (const ddl of candidateIndexes) {
    const started = performance.now();
    db.run(ddl);
    console.log(`\nbuilt in ${Math.round(performance.now() - started)} ms:  ${ddl}`);
  }
  const after = sample("AFTER");
  const factor = before / after;
  console.log(
    `\nresult   ${before.toFixed(2)} ms → ${after.toFixed(2)} ms` +
      (Number.isFinite(factor) ? `  (${factor >= 2 ? `${Math.round(factor)}× faster` : "no material change"})` : ""),
  );
  console.log("\nIf this is a keeper, add the DDL to datagenerator2 src/db/schema.js and");
  console.log("record it in docs/plan.md §7.2 with these numbers.");
}
