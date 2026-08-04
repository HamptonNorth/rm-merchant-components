// server/routes/harness.js — fixtures for the development harness.
//
// Scenarios resolve to real rows by query rather than hardcoded ids, so they survive
// datagenerator2 regenerating the dataset with different ids (docs/plan.md §6).

import { Hono } from "hono";
import { db, dbPath, dbSource, dbGeneratedAt, unusedLocalCopy } from "../db.js";

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

  // delivery-address
  {
    id: "delivery-most",
    component: "delivery-address",
    label: "Customer with the most addresses",
    resolve: () => db.query(`select customer_id as id from customer_delivery_address
                              group by 1 order by count(*) desc limit 1`).get(),
    props: (row) => ({ customerId: row.id, selectedId: null }),
  },
  {
    id: "delivery-single",
    component: "delivery-address",
    label: "Single address",
    resolve: () => db.query(`select customer_id as id from customer_delivery_address
                              group by 1 having count(*) = 1 order by customer_id limit 1`).get(),
    props: (row) => ({ customerId: row.id, selectedId: null }),
  },
  {
    id: "delivery-instructions",
    component: "delivery-address",
    label: "Site with unloading instructions",
    // The case the card is built around: a driver needs the hiab and the muddy-site warning
    // before setting off, not on arrival.
    resolve: () => db.query(`select customer_id as id from customer_delivery_address
                              where delivery_instructions <> '' and unload_method = 'hiab'
                              order by customer_id limit 1`).get(),
    props: (row) => ({ customerId: row.id, selectedId: null }),
  },
  {
    id: "delivery-none",
    component: "delivery-address",
    label: "No delivery address — a collect customer",
    resolve: () => db.query(`select c.id from customer c
        where not exists (select 1 from customer_delivery_address d where d.customer_id = c.id)
        order by c.id limit 1`).get(),
    props: (row) => ({ customerId: row.id, selectedId: null }),
  },

  // qty-input — the five entry modes. Three have no backing data, so they are driven by
  // explicit props rather than by a product that happens to be configured that way.
  {
    id: "qty-unit",
    component: "qty-input",
    label: "Units — 6 bolts at £2.50",
    resolve: () => db.query(`select id from product where uom_type='unit' and qty_per_pallet <= 1 order by id limit 1`).get(),
    props: (row) => ({ productId: row.id, tallyLengths: null, packSize: null }),
  },
  {
    id: "qty-pack",
    component: "qty-input",
    label: "Pallet of 366 — no price row uses a divisor, so packSize is set",
    resolve: () => db.query(`select id from product where uom_type='unit' order by id limit 1`).get(),
    props: (row) => ({ productId: row.id, packSize: 366, tallyLengths: null }),
  },
  {
    id: "qty-sheet",
    component: "qty-input",
    label: "Sheet material — priced per sheet or per 10m²",
    resolve: () => db.query(`select id from product where uom_type='sheet_material' order by id limit 1`).get(),
    props: (row) => ({ productId: row.id, tallyLengths: null, packSize: null }),
  },
  {
    id: "qty-tally-fixed",
    component: "qty-input",
    label: "Fixed tally — C16 CLS lengths",
    // product.tally_id is 0 for all 3,714 products, so the list comes from the tally table
    // directly. Without this the mode cannot be demonstrated at all.
    resolve: () => db.query(`select (select id from product where uom_type='tally' order by id limit 1) as id,
                                    (select tally from tally where id = 1) as lengths`).get(),
    props: (row) => ({ productId: row.id, tallyLengths: row.lengths.split(",").map(Number), packSize: null }),
  },
  {
    id: "qty-tally-hardwood",
    component: "qty-input",
    label: "Hardwood — random width, measured parcel by parcel",
    resolve: () => db.query(`select id from product where uom_type='tally' and name like '%Oak%' order by id limit 1`).get()
              ?? db.query(`select id from product where uom_type='tally' order by id limit 1`).get(),
    props: (row) => ({ productId: row.id, tallyLengths: null, packSize: null }),
  },

  // find-product — the interesting states are all about ranging, and none of them are
  // reachable by typing into an empty box without knowing the data first.
  {
    id: "product-specialist-branch",
    component: "find-product",
    label: "Specialist branch — where availability differs most",
    // The branch that HOLDS what other branches only obtain — not simply the one ranging the
    // most lines, which is a different branch. This is where the five states differ from one
    // another rather than all reading "In range".
    resolve: () => db.query(`select pb.branch_id as id from product_branch pb
                              where pb.status in ('core','stocked')
                                and pb.product_id in (select product_id from product_branch
                                                       where status = 'non_stock')
                              group by pb.branch_id order by count(*) desc limit 1`).get(),
    props: (row) => ({ workingBranchId: row.id, scope: "branch", groupPath: "", collapseOnSelect: false }),
  },
  {
    id: "product-blocked-branch",
    component: "find-product",
    label: "A branch with a line it may not sell",
    // Search the code shown to see the not_permitted state; it is greyed and refuses
    // selection rather than being hidden.
    resolve: () => db.query(`select pb.branch_id as id, p.code from product_branch pb
                              join product p on p.id = pb.product_id
                             where pb.status = 'not_permitted' limit 1`).get(),
    props: (row) => ({ workingBranchId: row.id, scope: "all", groupPath: "", collapseOnSelect: false }),
    note: (row) => `Search ${row.code} — this branch may not sell it.`,
  },
  {
    id: "product-browse-group",
    component: "find-product",
    label: "Browse a group, no search term",
    // The largest group the busiest branch ranges — enough rows to need the pager.
    resolve: () => db.query(`select pb.branch_id as id, 'Top.Timber' as path from product_branch pb
                             group by pb.branch_id order by count(*) desc limit 1`).get(),
    props: (row) => ({ workingBranchId: row.id, scope: "branch", groupPath: row.path, collapseOnSelect: false }),
  },
  {
    id: "product-collapse-on-select",
    component: "find-product",
    label: "Collapse on select — the flow shape",
    // How the counter-sale flow mounts it. Worth having as a preset: the collapsed state has
    // its own ways back out (Back to results, New search, Escape, or just retyping) and they
    // are easy to leave broken because the component page does not use them.
    resolve: () => db.query(`select branch_id as id from product_branch group by branch_id
                              order by count(*) desc limit 1`).get(),
    props: (row) => ({ workingBranchId: row.id, scope: "branch", collapseOnSelect: true, groupPath: "" }),
  },
  {
    id: "product-thin-range",
    component: "find-product",
    label: "Branch with the thinnest range",
    resolve: () => db.query(`select branch_id as id from product_branch group by branch_id
                              order by count(*) asc limit 1`).get(),
    props: (row) => ({ workingBranchId: row.id, scope: "branch", groupPath: "", collapseOnSelect: false }),
  },

  // credit-status — the verdicts that change what a counter hand does.
  {
    id: "credit-ok",
    component: "credit-status",
    label: "Healthy credit account",
    resolve: () => db.query(`select c.id from customer c
        where c.account_type='credit' and c.credit_status='normal'
          and (select coalesce(sum(unpaid_pence),0) from aged_debt a where a.customer_id=c.id)
              between 1 and c.credit_limit_pence * 0.5
        order by c.id limit 1`).get(),
    props: (row) => ({ customerId: row.id, view: "unpaid" }),
  },
  {
    id: "credit-over-limit",
    component: "credit-status",
    label: "Over the credit limit",
    resolve: () => db.query(`select c.id from customer c
        where c.account_type='credit'
          and (select coalesce(sum(unpaid_pence),0) from aged_debt a where a.customer_id=c.id)
              > c.credit_limit_pence
        order by c.id limit 1`).get(),
    props: (row) => ({ customerId: row.id, view: "unpaid" }),
  },
  {
    id: "credit-on-stop",
    component: "credit-status",
    label: "On stop — do not release goods",
    resolve: () => db.query(`select id from customer where credit_status='on_stop' order by id limit 1`).get(),
    props: (row) => ({ customerId: row.id, view: "unpaid" }),
  },
  {
    id: "credit-cash",
    component: "credit-status",
    label: "Cash account with history",
    // No credit facility, so limit and headroom are meaningless and must not be shown.
    resolve: () => db.query(`select c.id from customer c
        where c.account_type='cash'
          and exists (select 1 from aged_debt a where a.customer_id = c.id)
        order by c.id limit 1`).get(),
    props: (row) => ({ customerId: row.id, view: "recent" }),
  },
  {
    id: "credit-heaviest",
    component: "credit-status",
    label: "Most unpaid invoices in the dataset",
    resolve: () => db.query(`select customer_id as id from aged_debt where unpaid_pence > 0
                              group by 1 order by count(*) desc limit 1`).get(),
    props: (row) => ({ customerId: row.id, view: "unpaid", dense: true }),
  },
  {
    id: "credit-nothing-owed",
    component: "credit-status",
    label: "Nothing outstanding",
    resolve: () => db.query(`select c.id from customer c
        where c.account_type='credit'
          and not exists (select 1 from aged_debt a where a.customer_id=c.id and a.unpaid_pence>0)
          and exists (select 1 from aged_debt a where a.customer_id=c.id)
        order by c.id limit 1`).get(),
    props: (row) => ({ customerId: row.id, view: "recent" }),
  },

  // find-customer — the four routes, plus the case widening exists for.
  {
    id: "find-busiest-branch",
    component: "find-customer",
    label: "Busiest branch (3,600+ customers)",
    resolve: () =>
      db.query(`select home_branch_id as id, count(*) n from customer
                 group by 1 order by n desc limit 1`).get(),
    props: (row) => ({ workingBranchId: row.id, scope: "branch" }),
  },
  {
    id: "find-smallest-branch",
    component: "find-customer",
    label: "Smallest branch — where widening earns its keep",
    // Newtown holds ~90 customers against Stockport's 3,600. A counter here reaches for the
    // widen control constantly, which is why branch_neighbour is curated rather than derived.
    resolve: () =>
      db.query(`select c.home_branch_id as id, count(*) n from customer c
                 join branch b on b.id = c.home_branch_id
                where b.branch_type = 'trading' group by 1 order by n asc limit 1`).get(),
    props: (row) => ({ workingBranchId: row.id, scope: "branch" }),
  },
  {
    id: "find-quick-codes",
    component: "find-customer",
    label: "Branch with a full 1-9 keypad",
    resolve: () =>
      db.query(`select branch_id as id, count(*) n from branch_quick_code
                 group by 1 order by n desc limit 1`).get(),
    props: (row) => ({ workingBranchId: row.id, scope: "branch" }),
  },
  {
    id: "find-already-widened",
    component: "find-customer",
    label: "Already widened to neighbours",
    resolve: () => db.query(`select branch_id as id from branch_neighbour order by branch_id limit 1`).get(),
    props: (row) => ({ workingBranchId: row.id, scope: "neighbours" }),
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
  return c.json({
    dbPath,
    dbSource,
    generatedAt: dbGeneratedAt.toISOString(),
    unusedLocalCopy,
    counts,
    explicitIndexes,
    hasIndexes: explicitIndexes > 0,
  });
});
