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
  // The three access states the notice has to distinguish. Being away from your default
  // branch is normal; having no permissions there is not.
  {
    id: "access-default",
    component: "working-branch",
    label: "Access · at their default branch",
    resolve: () =>
      db
        .query(
          `select ub.app_user_id as user_id, ub.branch_id
             from app_user_branch ub where ub.is_default = 1
            order by ub.app_user_id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.user_id, selectedId: row.branch_id, allowedCodes: null }),
  },
  {
    id: "access-permitted-reduced",
    component: "working-branch",
    label: "Access · covered branch, fewer permissions than at home",
    // The case that makes the permission count worth showing: a valid working branch where
    // the user can do materially less than at their default.
    resolve: () =>
      db
        .query(
          `select ub.app_user_id as user_id, ub.branch_id,
                  (select count(*) from app_user_permission up
                    where up.app_user_id = ub.app_user_id and up.branch_id = ub.branch_id) as n
             from app_user_branch ub
            where ub.is_default = 0
              and n > 0
              and n < (select count(*) from app_user_permission up2
                        join app_user_branch d on d.app_user_id = up2.app_user_id
                                              and d.branch_id  = up2.branch_id
                       where up2.app_user_id = ub.app_user_id and d.is_default = 1)
            order by ub.app_user_id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.user_id, selectedId: row.branch_id, allowedCodes: null }),
  },
  {
    id: "access-denied",
    component: "working-branch",
    label: "Access · no permissions at the selected branch",
    // A working branch restored from a stale session, or access revoked since. The select
    // cannot reach this state on its own, so the host sets it.
    resolve: () =>
      db
        .query(
          `select u.id as user_id, b.id as branch_id
             from app_user u, branch b
            where not exists (select 1 from app_user_branch ub
                               where ub.app_user_id = u.id and ub.branch_id = b.id)
            order by u.id, b.id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.user_id, selectedId: row.branch_id, allowedCodes: null }),
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
    id: "perms-fixture-158",
    component: "user-permissions-view",
    label: "Fixture 158 — everything at 01-04 + head office, sales at 11-14",
    // Built to a written spec in datagenerator2 src/generate/permissions.js rather than from
    // a role, so these branch sets do not move when the seed changes. Exercises all three
    // range forms in one card: a count, a region plus a straggler, and a whole region.
    resolve: () => db.query("select id from app_user where id = 158").get(),
    props: (row) => ({ userId: row.id, dense: true }),
  },
  {
    id: "perms-fixture-159",
    component: "user-permissions-view",
    label: "Fixture 159 — everything in London, sales at 42-43",
    // 42 and 43 are 2 of the Midlands' 3 branches, so they must be named rather than
    // collapsed to "all 2 Midlands branches".
    resolve: () => db.query("select id from app_user where id = 159").get(),
    props: (row) => ({ userId: row.id, dense: true }),
  },
  // Scoped to a working branch — the everyday path once past the sign-in gate.
  {
    id: "perms-working-default",
    component: "user-permissions-view",
    label: "Signed in · at their default branch",
    resolve: () =>
      db
        .query(
          `select ub.app_user_id as id, ub.branch_id from app_user_branch ub
            where ub.is_default = 1 and ub.app_user_id in
                  (select app_user_id from app_user_branch group by app_user_id having count(*) > 1)
            order by ub.app_user_id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.id, workingBranchId: row.branch_id, expanded: false }),
  },
  {
    id: "perms-working-reduced",
    component: "user-permissions-view",
    label: "Signed in · away from home, fewer permissions",
    // The case the scoping exists for: the header count must say what applies HERE, not
    // what the user holds across the network.
    resolve: () =>
      db
        .query(
          `select ub.app_user_id as id, ub.branch_id,
                  (select count(*) from app_user_permission up
                    where up.app_user_id = ub.app_user_id and up.branch_id = ub.branch_id) as n
             from app_user_branch ub
            where ub.is_default = 0
              and n > 0
              and n < (select count(*) from app_user_permission up2
                        join app_user_branch d on d.app_user_id = up2.app_user_id
                                              and d.branch_id  = up2.branch_id
                       where up2.app_user_id = ub.app_user_id and d.is_default = 1)
            order by ub.app_user_id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.id, workingBranchId: row.branch_id, expanded: true }),
  },
  {
    id: "perms-working-head-office",
    component: "user-permissions-view",
    label: "Signed in · head office, 28 other branches expanded",
    // 28 other branches collapse to a handful of groups. One section per branch would be
    // the wall the card exists to avoid.
    resolve: () =>
      db
        .query(
          `select ub.app_user_id as id, ub.branch_id from app_user_branch ub
            where ub.is_default = 1
              and ub.app_user_id = (select app_user_id from app_user_permission
                                     group by app_user_id order by count(*) desc limit 1)`,
        )
        .get(),
    props: (row) => ({ userId: row.id, workingBranchId: row.branch_id, expanded: true }),
  },
  {
    id: "perms-working-denied",
    component: "user-permissions-view",
    label: "Signed in · no permissions at that branch",
    resolve: () =>
      db
        .query(
          `select u.id, b.id as branch_id from app_user u, branch b
            where not exists (select 1 from app_user_branch ub
                               where ub.app_user_id = u.id and ub.branch_id = b.id)
            order by u.id, b.id limit 1`,
        )
        .get(),
    props: (row) => ({ userId: row.id, workingBranchId: row.branch_id, expanded: false }),
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
