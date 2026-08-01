// server/routes/harness.js — fixtures for the development harness.
//
// Scenarios resolve to real rows by query rather than hardcoded ids, so they survive
// datagenerator2 regenerating the dataset with different ids (docs/plan.md §6).

import { Hono } from "hono";
import { db, dbPath } from "../db.js";

export const harness = new Hono();

// Each scenario names a row the harness can load into a component to exercise an edge
// case. `resolve` returns whatever props that component needs, or null when the dataset
// has no matching row — in which case the harness shows the scenario as unavailable
// rather than silently offering a broken fixture.
const SCENARIOS = [
  {
    id: "branch-first",
    component: "select-branch",
    label: "First branch (by code)",
    resolve: () => db.query("select id from branch order by code limit 1").get(),
    props: (row) => ({ selectedId: row.id }),
  },
  {
    id: "branch-largest-region",
    component: "select-branch",
    label: "Region with most branches",
    resolve: () =>
      db
        .query(
          `select region_id as id, count(*) as n from branch
            where region_id is not null group by region_id order by n desc limit 1`,
        )
        .get(),
    props: (row) => ({ regionId: row.id }),
  },
  {
    id: "branch-none-selected",
    component: "select-branch",
    label: "Nothing selected",
    resolve: () => ({ ok: true }),
    props: () => ({ selectedId: null, regionId: null }),
  },
];

harness.get("/scenarios", (c) => {
  const component = c.req.query("component");
  const rows = SCENARIOS.filter((s) => !component || s.component === component).map((s) => {
    let row = null;
    let error = null;
    try {
      row = s.resolve();
    } catch (e) {
      error = e.message;
    }
    return {
      id: s.id,
      component: s.component,
      label: s.label,
      available: Boolean(row) && !error,
      error,
      props: row && !error ? s.props(row) : null,
    };
  });
  return c.json({ rows, total: rows.length });
});

harness.get("/dataset", (c) => {
  const counts = {};
  for (const t of ["branch", "region", "customer", "product", "supplier"]) {
    counts[t] = db.query(`select count(*) as c from ${t}`).get().c;
  }
  // Only explicit indexes count. SQLite creates sqlite_autoindex_* entries for UNIQUE
  // columns (supplier.code, product.code) with a null sql, and those are not the ones
  // docs/plan.md §7.2 is about.
  const explicitIndexes = db
    .query("select count(*) as c from sqlite_master where type='index' and sql is not null")
    .get().c;
  return c.json({ dbPath, counts, explicitIndexes, hasIndexes: explicitIndexes > 0 });
});
