// server/db.js — the single readonly handle onto the datagenerator2 dataset.
//
// The dataset is generated elsewhere and consumed in place (docs/plan.md §1, §3); nothing
// here ever writes. Every query goes through measured(), which times it and — in dev —
// captures its EXPLAIN QUERY PLAN so the harness request log can flag a missing index
// while the UI is being built rather than later (§7.4).

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_DB_PATH = resolve(projectRoot, "../datagenerator2/out/datagenerator.db");

export const dbPath = process.env.MERCHANT_DB_PATH
  ? resolve(process.env.MERCHANT_DB_PATH)
  : DEFAULT_DB_PATH;

export const isDev = process.env.NODE_ENV !== "production";

if (!existsSync(dbPath)) {
  throw new Error(
    `Dataset not found at ${dbPath}\n` +
      `  This project reads datagenerator2's generated SQLite file read-only.\n` +
      `  Generate it with \`bun run generate\` in datagenerator2, or point MERCHANT_DB_PATH\n` +
      `  at an existing copy:  MERCHANT_DB_PATH=/path/to/datagenerator.db bun run dev`,
  );
}

export const db = new Database(dbPath, { readonly: true });

// Plans are only interesting during development, and EXPLAIN costs a second prepare.
function planFor(sql, params) {
  try {
    return db
      .query(`explain query plan ${sql}`)
      .all(...params)
      .map((r) => r.detail);
  } catch {
    return [];
  }
}

// A plan line containing either of these means SQLite is doing work an index could avoid.
const SLOW_MARKERS = [/\bSCAN\b/, /TEMP B-TREE/];

// Scanning is only a problem when it costs something. A full scan of the 28-row branch
// table takes 0.4 ms and wants no index; the same plan over aged_debt's 1.19M rows takes
// 38 ms and very much does. Warning on the plan alone would cry wolf on every small
// lookup and train us to ignore it, so the time has to agree.
export const WARN_MS = Number(process.env.MERCHANT_WARN_MS ?? 5);

export function planWarnings(plan, tookMs) {
  if (tookMs < WARN_MS) return [];
  return plan.filter((line) => SLOW_MARKERS.some((re) => re.test(line)));
}

// Run a named query and return rows plus the timing/plan metadata the harness displays.
export function measured(name, sql, params = []) {
  const started = performance.now();
  const rows = db.query(sql).all(...params);
  const tookMs = Number((performance.now() - started).toFixed(2));
  const plan = isDev ? planFor(sql, params) : [];
  return { query: name, rows, total: rows.length, tookMs, plan, warnings: planWarnings(plan, tookMs) };
}

// Single-row variant; returns null rather than undefined so JSON stays predictable.
export function measuredOne(name, sql, params = []) {
  const result = measured(name, sql, params);
  return { ...result, row: result.rows[0] ?? null };
}
