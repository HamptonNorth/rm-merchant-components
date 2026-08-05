// server/queries/features.js — "which record demonstrates this?"
//
// The crib list, as a query rather than a document. A written list of "customer 18314 has
// three delivery addresses" is correct until the next `bun run generate` and silently wrong
// afterwards: ids move with the seed. That is not hypothetical — a hardcoded branch id in
// find-product's harness defaults pointed at Leeds when it was written and at Cambridge after
// a regeneration, and nothing complained.
//
// So each feature carries the SQL that finds it. Every entry answers three things: does this
// exist in the current dataset, how many are there, and give me one to try.
//
// `count(*) over ()` computes the full total before LIMIT applies, so one query returns both
// the examples and how many there are — no second counting query, and no chance of the two
// disagreeing.

import { measured } from "../db.js";

// A feature is: an id, what it demonstrates, why anyone cares, and SQL returning
//   id | label | detail | total
// most-useful-first. `component` and `props` are optional and make it openable in the
// harness at exactly that state.
const FEATURES = [
  // --- customers ------------------------------------------------------------
  {
    id: "customer-many-delivery-addresses",
    audience: "demo",
    demoLabel: "Customers with several delivery sites",
    demoWhy: "A groundworks customer running four sites at once. Each address carries its own project reference, access notes and unload method — what the driver needs before setting off.",
    entity: "customer",
    label: "Customer with 3+ delivery addresses",
    why: "delivery-address is built around the populated case, but most customers have none — this is how you see the list rather than the empty state.",
    component: "delivery-address",
    props: (r) => ({ customerId: r.id }),
    sql: `select c.id, c.name as label, count(d.id) || ' addresses' as detail,
                 count(*) over () as total
            from customer c join customer_delivery_address d on d.customer_id = c.id
           group by c.id having count(d.id) >= 3
           order by count(d.id) desc limit ?1`,
  },
  {
    id: "customer-no-delivery-addresses",
    entity: "customer",
    label: "Customer with no delivery address",
    why: "The common case, and therefore the empty state that matters most.",
    component: "delivery-address",
    props: (r) => ({ customerId: r.id }),
    sql: `select c.id, c.name as label, 'none on file' as detail, count(*) over () as total
            from customer c
           where not exists (select 1 from customer_delivery_address where customer_id = c.id)
           order by c.id limit ?1`,
  },
  {
    id: "customer-on-stop",
    audience: "demo",
    demoLabel: "Accounts on stop are refused at the counter",
    demoWhy: "The counter is told plainly, before goods are released rather than after the invoice.",
    entity: "customer",
    label: "Customer on stop",
    why: "credit-status must refuse plainly. Also drives the flow's stop warning.",
    component: "credit-status",
    props: (r) => ({ customerId: r.id }),
    sql: `select id, name as label, credit_status as detail, count(*) over () as total
            from customer where credit_status = 'on_stop' order by id limit ?1`,
  },
  {
    id: "customer-over-limit",
    audience: "demo",
    demoLabel: "Over the credit limit",
    demoWhy: "Outstanding against limit, worked out live from the ledger rather than from a flag somebody has to remember to set.",
    entity: "customer",
    label: "Customer over their credit limit",
    why: "The verdict that is computed rather than stored — outstanding against limit.",
    // The unpaid filter belongs in the JOIN, not just the HAVING: paid rows contribute
    // nothing to the sum but are still aggregated. Same 639 customers, 232ms -> 102ms.
    component: "credit-status",
    props: (r) => ({ customerId: r.id }),
    sql: `select c.id, c.name as label,
                 'owes ' || (sum(a.unpaid_pence)/100) || ' of ' || (c.credit_limit_pence/100) as detail,
                 count(*) over () as total
            from customer c join aged_debt a on a.customer_id = c.id and a.unpaid_pence > 0
           where c.credit_limit_pence > 0
           group by c.id having sum(a.unpaid_pence) > c.credit_limit_pence
           order by sum(a.unpaid_pence) - c.credit_limit_pence desc limit ?1`,
  },
  {
    id: "customer-many-unpaid",
    audience: "demo",
    demoLabel: "What does this account owe?",
    demoWhy: "Ageing buckets over the open items, drillable down to the invoice.",
    entity: "customer",
    label: "Customer with many unpaid invoices",
    why: "Exercises paging in the invoice drill-down rather than a single short list.",
    component: "credit-status",
    props: (r) => ({ customerId: r.id }),
    sql: `select c.id, c.name as label, count(a.id) || ' unpaid' as detail,
                 count(*) over () as total
            from customer c join aged_debt a on a.customer_id = c.id and a.unpaid_pence > 0
           group by c.id having count(a.id) >= 20 order by count(a.id) desc limit ?1`,
  },
  {
    id: "customer-national-account",
    audience: "demo",
    demoLabel: "National accounts reachable from any branch",
    demoWhy: "A national account is in scope wherever it is asked for, not only at the branch that owns it.",
    entity: "customer",
    label: "National account",
    why: "In scope at every branch regardless of the working branch, so it should appear in a narrow search.",
    component: "find-customer",
    props: (r) => ({ scope: "branch", workingBranchId: r.home_branch_id }),
    sql: `select id, name as label, 'home branch ' || home_branch_id as detail,
                 home_branch_id, count(*) over () as total
            from customer where is_national_account = 1 order by id limit ?1`,
  },
  {
    id: "customer-counter-cash",
    audience: "demo",
    demoLabel: "One keystroke to the counter cash account",
    demoWhy: "Digit 1 at any branch reaches that branch's own cash account, so takings attribute to the branch that made the sale.",
    entity: "customer",
    label: "Branch counter cash account (quick code 1)",
    why: "One keystroke reaches it. Takings attribute to the branch that made the sale.",
    component: "find-customer",
    props: (r) => ({ workingBranchId: r.home_branch_id, scope: "branch" }),
    sql: `select c.id, c.name as label, 'quick code ' || q.quick_code as detail,
                 c.home_branch_id, count(*) over () as total
            from customer c join branch_quick_code q on q.customer_id = c.id
           where q.quick_code = 1 order by c.home_branch_id limit ?1`,
  },
  {
    id: "customer-po-required",
    audience: "demo",
    demoLabel: "Accounts that require a purchase-order number",
    demoWhy: "Flagged on the account, so the counter is prompted before the order is taken.",
    entity: "customer",
    label: "Customer requiring a purchase-order number",
    why: "must-cater-for: 'PO required (match to shape)'. The flag exists; nothing consumes it yet.",
    sql: `select id, name as label, 'po_required' as detail, count(*) over () as total
            from customer where po_required = 1 order by id limit ?1`,
  },

  // --- products -------------------------------------------------------------
  {
    id: "product-quantity-breaks",
    audience: "demo",
    demoLabel: "Quantity breaks",
    demoWhy: "Buy more, pay less — the price steps down at defined quantities.",
    entity: "product",
    label: "Product with genuine quantity breaks",
    why: "The ONLY shape where product-detail shows a Quantity column. Everything else has degenerate scheme tiers and its prices are customer bands.",
    component: "product-detail",
    props: (r) => ({ productId: r.id }),
    sql: `select p.id, p.name as label, pb.name as detail, count(*) over () as total
            from product p join price_break pb on pb.id = p.price_break_id
           where exists (select 1 from price_break_tier t
                          where t.price_break_id = p.price_break_id
                            and t.qty_to > 1 and t.qty_to < 99999999)
           order by p.id limit ?1`,
  },
  {
    id: "product-two-price-units",
    audience: "demo",
    demoLabel: "Priced two ways at once",
    demoWhy: "Sold per sheet or per 10m², whichever the customer asks for, with the quantity input resolving both to the same line value.",
    entity: "product",
    label: "Product priced in two different units",
    why: "The price changes unit between tiers — per each up to tier 4, per 10m2 above. A bare pence figure is meaningless against these.",
    component: "product-detail",
    props: (r) => ({ productId: r.id }),
    sql: `select p.id, p.name as label,
                 group_concat(distinct u.per) as detail, count(*) over () as total
            from product p join product_price pp on pp.product_id = p.id
            join unit_of_measure u on u.id = pp.unit_of_measure_id
           group by p.id having count(distinct pp.unit_of_measure_id) > 1
           order by p.id limit ?1`,
  },
  {
    id: "product-not-permitted",
    audience: "demo",
    demoLabel: "Lines a branch is not allowed to sell",
    demoWhy: "Age-restricted goods, or a manufacturer's system with no accredited fitter at that branch. Found, shown, and refused.",
    entity: "product",
    label: "Product a branch may not sell",
    why: "The one negative that is stored. Shown greyed and refuses selection — it has to beat the special-order default.",
    component: "find-product",
    props: (r) => ({ workingBranchId: r.branch_id, scope: "all" }),
    sql: `select p.id, p.name as label,
                 'blocked at ' || b.name as detail, pb.branch_id, count(*) over () as total
            from product_branch pb join product p on p.id = pb.product_id
            join branch b on b.id = pb.branch_id
           where pb.status = 'not_permitted' order by p.id limit ?1`,
  },
  {
    id: "product-ranged-nowhere",
    audience: "demo",
    demoLabel: "Special orders",
    demoWhy: "Not held anywhere and still sellable — ordered in from the supplier against the customer's order.",
    entity: "product",
    label: "Product ranged at no branch (special order)",
    why: "The special-order tail. Sellable but held nowhere — proves the path that is not 'we have it'.",
    component: "find-product",
    props: () => ({ scope: "all" }),
    sql: `select p.id, p.name as label, 'special order' as detail, count(*) over () as total
            from product p
           where not exists (select 1 from product_branch where product_id = p.id)
           order by p.id limit ?1`,
  },
  {
    id: "product-non-stock",
    audience: "demo",
    demoLabel: "Sold but not held — brought in per order",
    demoWhy: "The specialist branch carries the range; every other branch obtains each one as it sells.",
    entity: "product",
    label: "Product sold but never held (non_stock)",
    why: "The specialist branch holds the category; the others obtain each one per order.",
    component: "find-product",
    props: (r) => ({ workingBranchId: r.branch_id, scope: "branch" }),
    sql: `select p.id, p.name as label, 'to order at ' || b.name as detail,
                 pb.branch_id, count(*) over () as total
            from product_branch pb join product p on p.id = pb.product_id
            join branch b on b.id = pb.branch_id
           where pb.status = 'non_stock' order by p.id limit ?1`,
  },
  {
    id: "product-tally",
    entity: "product",
    label: "Timber tally product",
    why: "qty-input's tally modes. NOTE: tally_id is 0 on every product, so the length list cannot be resolved from the data — the mode runs on props only.",
    component: "qty-input",
    props: (r) => ({ productId: r.id }),
    sql: `select id, name as label, 'uom_type=tally, tally_id=' || tally_id as detail,
                 count(*) over () as total
            from product where uom_type = 'tally' order by id limit ?1`,
  },
  {
    id: "product-sheet-material",
    entity: "product",
    label: "Sheet material",
    why: "qty-input's sheet mode. NOTE: 56 of these are priced per each rather than per 10m2, so most cannot exercise area pricing.",
    component: "qty-input",
    props: (r) => ({ productId: r.id }),
    sql: `select p.id, p.name as label,
                 'priced ' || group_concat(distinct u.per) as detail, count(*) over () as total
            from product p join product_price pp on pp.product_id = p.id
            join unit_of_measure u on u.id = pp.unit_of_measure_id
           where p.uom_type = 'sheet_material' group by p.id order by p.id limit ?1`,
  },
  {
    id: "product-with-barcode",
    entity: "product",
    label: "Product with a scannable barcode",
    why: "find-product's barcode route. Only 5% of the catalogue carries one, and outer/pallet barcodes are empty everywhere.",
    component: "find-product",
    props: () => ({ scope: "all" }),
    sql: `select id, name as label, barcode_inner as detail, count(*) over () as total
            from product where barcode_inner is not null and barcode_inner <> ''
           order by id limit ?1`,
  },
  {
    id: "product-pallet-quantities",
    audience: "demo",
    demoLabel: "Sold by the pallet",
    demoWhy: "Bricks and blocks with the pack and pallet quantities held against the product.",
    entity: "product",
    label: "Product sold by the pallet",
    why: "qty-input's pack mode — bricks and blocks, where the pallet count drives the price.",
    component: "qty-input",
    props: (r) => ({ productId: r.id }),
    sql: `select id, name as label, qty_per_pallet || ' per pallet' as detail,
                 count(*) over () as total
            from product where qty_per_pallet > 1 order by qty_per_pallet desc limit ?1`,
  },
  {
    id: "product-narrowest-range",
    entity: "product",
    label: "Product ranged at the fewest branches",
    why: "The sharpest 'not here, but there' case. Nothing sits at exactly one branch in this dataset — the floor is two — so this asks for the minimum rather than assuming it.",
    component: "product-detail",
    props: (r) => ({ productId: r.id }),
    sql: `select p.id, p.name as label,
                 count(pb.id) || ' branches' as detail, count(*) over () as total
            from product p join product_branch pb on pb.product_id = p.id
           group by p.id order by count(pb.id) asc, p.id limit ?1`,
  },

  // --- branches -------------------------------------------------------------
  {
    id: "branch-specialist",
    audience: "demo",
    demoLabel: "A specialist branch supplying the others",
    demoWhy: "One branch stocks a category deeply on better terms; the rest transfer stock in as they sell it.",
    entity: "branch",
    label: "The specialist branch",
    why: "Holds a whole category the others only obtain, so the five availability states actually differ from one another here.",
    component: "find-product",
    props: (r) => ({ workingBranchId: r.id, scope: "branch" }),
    sql: `select b.id, b.name as label, count(*) || ' lines others only obtain' as detail,
                 count(*) over () as total
            from product_branch pb join branch b on b.id = pb.branch_id
           where pb.status in ('core','stocked')
             and pb.product_id in (select product_id from product_branch where status = 'non_stock')
           group by b.id order by count(*) desc limit ?1`,
  },
  {
    id: "branch-thin-range",
    entity: "branch",
    label: "Branch with the thinnest range",
    why: "Where a branch-scoped search most often finds nothing and has to offer widening.",
    component: "find-product",
    props: (r) => ({ workingBranchId: r.id, scope: "branch" }),
    sql: `select b.id, b.name as label, count(*) || ' of 3,714 ranged' as detail,
                 count(*) over () as total
            from product_branch pb join branch b on b.id = pb.branch_id
           group by b.id order by count(*) asc limit ?1`,
  },
  {
    id: "branch-non-trading",
    entity: "branch",
    label: "Head office (not a trading branch)",
    why: "Ranges nothing and sells nothing. Operational pickers must filter it out — and a branch id is not a branch code.",
    sql: `select id, name as label, 'branch_type=' || branch_type || ', code ' || code as detail,
                 count(*) over () as total
            from branch where branch_type <> 'trading' order by id limit ?1`,
  },
  {
    id: "branch-neighbours",
    audience: "demo",
    demoLabel: "Widening a search to nearby branches",
    demoWhy: "Curated neighbours rather than map distance — Chester reaching Bangor is a real journey, Chester reaching Cornwall is not.",
    entity: "branch",
    label: "Branch with a neighbour outside its own region",
    why: "Why the widen step is curated rather than derived from region_id.",
    component: "find-customer",
    props: (r) => ({ workingBranchId: r.id, scope: "neighbours" }),
    sql: `select b.id, b.name as label,
                 'neighbour ' || nb.name || ' (' || nr.name || ')' as detail,
                 count(*) over () as total
            from branch_neighbour n
            join branch b on b.id = n.branch_id
            join branch nb on nb.id = n.neighbour_branch_id
            left join region r on r.id = b.region_id
            left join region nr on nr.id = nb.region_id
           where b.region_id <> nb.region_id order by b.id limit ?1`,
  },

  // --- staff ----------------------------------------------------------------
  {
    id: "staff-multi-branch",
    audience: "demo",
    demoLabel: "Staff covering more than one branch",
    demoWhy: "A rep signs in and picks where they are working today; permissions follow the branch.",
    entity: "staff",
    label: "Member of staff covering several branches",
    why: "working-branch has to offer a choice rather than a fixed site, and permissions differ per branch.",
    component: "working-branch",
    props: (r) => ({ userId: r.id }),
    sql: `select u.id, u.given_name || ' ' || u.surname as label,
                 count(*) || ' branches' as detail, count(*) over () as total
            from app_user u join app_user_branch ub on ub.app_user_id = u.id
           group by u.id having count(*) > 1 order by count(*) desc limit ?1`,
  },
  {
    id: "staff-head-office",
    audience: "demo",
    demoLabel: "Head office sees every branch",
    demoWhy: "The top of the approval chain, which is what guarantees an escalation always terminates.",
    entity: "staff",
    label: "Head-office user (every branch, no limits)",
    why: "The top of the approval chain — what guarantees escalation always terminates.",
    component: "user-permissions-view",
    props: (r) => ({ userId: r.id }),
    sql: `select u.id, u.given_name || ' ' || u.surname as label,
                 r.role || ', ' || count(distinct ub.branch_id) || ' branches' as detail,
                 count(*) over () as total
            from app_user u join app_user_branch ub on ub.app_user_id = u.id
            join app_role r on r.id = ub.app_role_id
           where r.code = 'head_office' group by u.id limit ?1`,
  },
  {
    id: "staff-with-approval-limit",
    audience: "demo",
    demoLabel: "Authorisation limits and escalation",
    demoWhy: "Below the limit it goes through; above it, it routes to someone who can approve. The action is never simply refused.",
    entity: "staff",
    label: "Member of staff with an approval threshold",
    why: "The limit is an auto-approval threshold, not a ceiling — above it the action routes rather than being refused.",
    component: "user-permissions-view",
    props: (r) => ({ userId: r.id }),
    // One row per person, not per grant — a user holding four limited permissions was
    // appearing four times and looking like four different people.
    sql: `select u.id, u.given_name || ' ' || u.surname as label,
                 count(distinct up.permission_id) || ' limited, highest '
                   || (max(up.approval_limit_pence)/100) as detail,
                 count(*) over () as total
            from app_user_permission up join app_user u on u.id = up.app_user_id
           where up.approval_limit_pence > 0
           group by u.id order by max(up.approval_limit_pence) desc limit ?1`,
  },

  // --- known gaps -----------------------------------------------------------
  //
  // Features that SHOULD exist and return nothing. Listing them is the point: a zero here is
  // a documented upstream gap, not a broken query, and it stops the same discovery being
  // made three times.
  {
    id: "gap-part-paid-invoice",
    entity: "gap",
    label: "Part-paid invoice",
    why: "GAP: unpaid_pence is only ever 0 or the full gross, so no invoice is part-paid. credit-status handles it anyway; nothing exercises it.",
    sql: `select id, invoice_number as label, unpaid_pence || ' of ' || (goods_pence + tax_pence) as detail,
                 count(*) over () as total
            from aged_debt where unpaid_pence > 0 and unpaid_pence < (goods_pence + tax_pence)
           limit ?1`,
  },
  {
    id: "gap-credit-note",
    entity: "gap",
    label: "Credit note",
    why: "GAP: every aged_debt row is transaction_type='invoice'. No credit notes, no payments.",
    sql: `select id, invoice_number as label, transaction_type as detail, count(*) over () as total
            from aged_debt where transaction_type <> 'invoice' limit ?1`,
  },
  {
    id: "gap-product-tally-list",
    entity: "gap",
    label: "Product linked to a tally length list",
    why: "GAP: tally_id is 0 on all 3,714 products, though the tally table holds 10 real length lists. qty-input's fixed-tally mode has no data path.",
    sql: `select id, name as label, 'tally_id=' || tally_id as detail, count(*) over () as total
            from product where tally_id > 0 limit ?1`,
  },
  {
    id: "gap-archived-product",
    entity: "gap",
    label: "Archived product",
    why: "GAP: every product is active, so the filter that hides archived lines is never exercised.",
    sql: `select id, name as label, status as detail, count(*) over () as total
            from product where status <> 'active' limit ?1`,
  },
  {
    id: "gap-outer-barcode",
    entity: "gap",
    label: "Outer or pallet barcode",
    why: "GAP: both are empty on every row. Scanning a shrink-wrapped pack should find the pack, not the piece.",
    sql: `select id, name as label,
                 coalesce(nullif(barcode_outer,''), barcode_pallet) as detail, count(*) over () as total
            from product
           where (barcode_outer is not null and barcode_outer <> '')
              or (barcode_pallet is not null and barcode_pallet <> '') limit ?1`,
  },
  {
    id: "gap-customer-price-band",
    entity: "gap",
    label: "Customer carrying a price band",
    why: "GAP: no column links a customer to the price tier they should be charged at, so product-detail cannot show 'their' price.",
    sql: `select id, name as label, 'n/a' as detail, count(*) over () as total
            from customer where 0 limit ?1`,
  },
];

const EXAMPLES = 5;

// Matching is deliberately loose — id, label and the reason are all searched, so "delivery",
// "tally" and "why is this empty" all land somewhere useful.
function matches(f, q) {
  if (!q) return true;
  const hay = `${f.id} ${f.label} ${f.why} ${f.entity}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

// Anything not explicitly marked is internal. An allowlist rather than a blocklist, because
// the failure modes are not symmetric: forgetting to mark a new probe `demo` hides something
// that could have been shown, while forgetting to mark one `internal` shows a prospect the
// list of things this system cannot do.
function isDemo(f) {
  return f.audience === "demo";
}

export function listFeatures({ q = "", entity = "", limit = EXAMPLES, audience = "" } = {}) {
  const started = performance.now();
  const rows = FEATURES.filter(
    (f) =>
      (!entity || f.entity === entity) &&
      (audience !== "demo" || isDemo(f)) &&
      matches(f, q),
  ).map((f) => {
    let examples = [];
    let total = 0;
    let error = null;
    try {
      const r = measured(`features.${f.id}`, f.sql, [limit]);
      examples = r.rows;
      total = examples[0]?.total ?? 0;
    } catch (e) {
      error = e.message;
    }
    return {
      id: f.id,
      entity: f.entity,
      audience: isDemo(f) ? "demo" : "internal",
      label: f.label,
      why: f.why,
      component: f.component ?? null,
      demoLabel: f.demoLabel ?? null,
      demoWhy: f.demoWhy ?? null,
      total,
      // A gap is a feature that should exist and does not. Distinguishing it from a broken
      // query is the whole reason those entries are in the list.
      isGap: f.entity === "gap" || total === 0,
      error,
      examples: examples.map((row) => ({
        id: row.id,
        label: row.label,
        detail: row.detail,
        props: f.props && !error ? f.props(row) : null,
      })),
    };
  });
  return { rows, total: rows.length, tookMs: Number((performance.now() - started).toFixed(2)) };
}

// The outward-facing list. Deliberately a separate function rather than a parameter on
// listFeatures: the protection has to be structural, because `?audience=` is a query string
// and anything a caller can omit, a caller will eventually omit. Nothing in the gap section
// is marked demo, so a gap cannot reach a prospect through this door — and a test holds that.
export function listDemoFeatures({ q = "", limit = EXAMPLES } = {}) {
  const r = listFeatures({ q, limit, audience: "demo" });
  return {
    ...r,
    rows: r.rows.map(({ label, why, demoLabel, demoWhy, ...rest }) => ({
      ...rest,
      // Trade wording, not schema wording. "product_branch.status = non_stock" is precise and
      // useless to anyone evaluating the system.
      label: demoLabel ?? label,
      why: demoWhy ?? why,
    })),
  };
}

export function featureEntities() {
  return [...new Set(FEATURES.map((f) => f.entity))];
}
