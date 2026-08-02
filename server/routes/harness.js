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
    props: () => ({ selectedId: null, regionId: null, allowedCodes: null }),
  },
  {
    id: "branch-restricted-codes",
    component: "select-branch",
    label: "Restricted to 3 branch codes",
    resolve: () => db.query("select group_concat(code) as codes from (select code from branch order by code limit 3)").get(),
    props: (row) => ({ allowedCodes: row.codes.split(","), regionId: null }),
  },
  {
    id: "branch-unknown-code",
    component: "select-branch",
    label: "Access list with a typo",
    resolve: () => db.query("select code from branch order by code limit 1").get(),
    props: (row) => ({ allowedCodes: [row.code, "ZZ"], regionId: null }),
  },

  // working-branch — the employee's operating context.
  {
    id: "user-counter-staff",
    component: "working-branch",
    label: "Counter staff (single branch)",
    resolve: () =>
      db
        .query(
          `select u.id from app_user u join app_role r on r.id = u.default_role_id
            where r.role = 'Counter' order by u.id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.id, allowedCodes: null, selectedId: null }),
  },
  {
    id: "user-rep-two-branches",
    component: "working-branch",
    label: "Sales rep covering two branches",
    // Their default branch plus one more in the same region — the travelling-rep case
    // the role matrix will eventually express (docs/plan.md §7.7).
    resolve: () =>
      db
        .query(
          `select u.id as user_id,
                  (select group_concat(code) from (
                     select b2.code from branch b2
                      where b2.region_id = b.region_id order by b2.code limit 2)) as codes
             from app_user u
             join app_role r on r.id = u.default_role_id
             join branch b on b.id = u.default_branch_id
            where r.role = 'Sales' order by u.id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.user_id, allowedCodes: row.codes.split(","), selectedId: null }),
  },
  {
    id: "user-away-from-default",
    component: "working-branch",
    label: "Working away from default branch",
    resolve: () =>
      db
        .query(
          `select u.id as user_id, b.id as other_branch_id
             from app_user u, branch b
            where b.id <> u.default_branch_id order by u.id, b.id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.user_id, selectedId: row.other_branch_id, allowedCodes: null }),
  },
  {
    id: "user-manager",
    component: "working-branch",
    label: "Branch manager",
    resolve: () =>
      db
        .query(
          `select u.id from app_user u join app_role r on r.id = u.default_role_id
            where r.role = 'Manager' order by u.id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.id, allowedCodes: null, selectedId: null }),
  },

  // user-permissions-view — the four shapes the card has to survive, smallest to largest.
  {
    id: "perms-counter",
    component: "user-permissions-view",
    label: "Counter assistant (3 permissions, one branch)",
    // The floor case: nothing to collapse, so the density toggle should not appear.
    resolve: () =>
      db
        .query(
          `select u.id from app_user u join app_role r on r.id = u.default_role_id
            where r.code = 'counter' order by u.id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.id, dense: true }),
  },
  {
    id: "perms-rep-two-limits",
    component: "user-permissions-view",
    label: "Travelling rep (same permission, different limits)",
    // The case that forces grouping by permission AND limit: away branches carry half the
    // authority, so one permission must render as two lines.
    resolve: () =>
      db
        .query(
          `select up.app_user_id as id
             from app_user_permission up
            group by up.app_user_id, up.permission_id
           having count(distinct ifnull(up.approval_limit_pence, -1)) > 1
            order by up.app_user_id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.id, dense: true }),
  },
  {
    id: "perms-regional",
    component: "user-permissions-view",
    label: "Regional manager (a whole region)",
    // Should collapse to "All 4 <Region> branches" rather than naming four branches.
    resolve: () =>
      db
        .query(
          `select u.id from app_user u join app_role r on r.id = u.default_role_id
            where r.code = 'regional' order by u.id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.id, dense: true }),
  },
  {
    id: "perms-head-office",
    component: "user-permissions-view",
    label: "Head office (430 grants, 29 branches)",
    // The ceiling. Undense this one to see what the collapsing is for.
    resolve: () =>
      db
        .query(
          `select up.app_user_id as id, count(*) as n from app_user_permission up
            group by up.app_user_id order by n desc limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.id, dense: true }),
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
