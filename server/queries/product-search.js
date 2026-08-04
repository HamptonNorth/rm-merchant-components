// server/queries/product-search.js — finding a product from the trade counter.
//
// The customer search answers "who is this"; this one answers "can I sell you this, from
// here, today". Those are different questions, and the second is the one that makes a
// merchant system feel competent or useless.
//
// The catalogue is company-wide but a branch's range is not (requirements-product-ranging.md),
// so a result is never just a product — it is a product *at this branch*, in one of five
// states. Showing a hit without saying which state it is in is worse than not finding it:
// it invites someone to promise stock the yard has never carried.
//
// Routing is by what was typed, as with the customer search, but the shapes overlap far more
// — "0442BBBPLY" is a code, "5055149904301" is a barcode, "birch ply" is a name, and a
// counter hand types all three into the same box without thinking about it.

import { measured, db } from "../db.js";

// --- what a term is ----------------------------------------------------------

// Barcodes are EAN-13 here, but nothing about the search depends on the length being exactly
// 13 — any long run of digits is a scan, not something anybody typed on purpose.
const BARCODE = /^\d{8,14}$/;

// Below this a name search matches most of the catalogue and the results are noise. Codes
// are exempt: "04B" is a deliberate, useful prefix.
const MIN_NAME = 3;
const MIN_CODE = 2;

// A term with no spaces that carries at least one digit and one letter looks like a product
// code. Names in this catalogue are full of digits too ("25 x 50mm"), which is why the
// no-spaces test carries most of the weight.
const CODEISH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function routeFor(term) {
  const t = (term ?? "").trim();
  if (!t) return { route: "none" };
  if (BARCODE.test(t)) return { route: "barcode", term: t };

  // Everything else runs one query over code and name together. A counter hand typing "04BB"
  // wants the code and "birch ply" wants the name, and asking which they meant would be a
  // question they should never have to answer. Both are matched, and the row reports which
  // one hit so the UI can say so.
  const codeish = CODEISH.test(t) && t.length >= MIN_CODE;
  if (!codeish && t.length < MIN_NAME) return { route: "too_short", term: t };
  return { route: "search", term: t, codeish };
}

// Name tokens are ANDed, in any order: "ply birch" and "birch ply" find the same thing.
// Learned from the customer search, where sending the whole phrase as one term meant "gate
// build" found nothing because no name contains that string.
const MAX_TOKENS = 6;

function tokensOf(term) {
  return term.split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
}

// --- availability ------------------------------------------------------------

// The five states a product can be in at a branch, derived in one place so the API, the
// component and anything built later cannot disagree about what a missing ranging row means.
//
// `null` branch_status is the common case and is NOT an error: absence means the branch does
// not range the line, which still leaves it sellable as a special order. Distinguishing that
// from "we are not allowed to sell this" is the whole point of storing not_permitted.
export const AVAILABILITY = {
  held: { label: "In range", sellable: true, rank: 0 },
  to_order: { label: "To order", sellable: true, rank: 1 },
  elsewhere: { label: "Other branches", sellable: true, rank: 2 },
  special_order: { label: "Special order", sellable: true, rank: 3 },
  blocked: { label: "Not permitted here", sellable: false, rank: 4 },
};

export function availabilityOf(row) {
  if (row.branch_status === "core" || row.branch_status === "stocked") return "held";
  if (row.branch_status === "non_stock") return "to_order";
  if (row.branch_status === "not_permitted") return "blocked";
  return row.ranged_branches > 0 ? "elsewhere" : "special_order";
}

// --- the query ---------------------------------------------------------------

// One row is a product at a branch. `ranged_branches` answers "if not here, where?" without a
// second round trip — a covering-index count off ux_product_branch, measured at 0.002 ms.
//
// The tier-1 price carries its unit, and it has to. 266 products change unit between tiers —
// per each up to tier 4, per pallet at 5 — so a bare pence figure means nothing on its own.
// `price_uom_count` flags those, because "£2.50" against a product priced two ways is a
// half-truth the counter has to be able to see.
const SELECT = `
  select p.id, p.code, p.name, p.uom_type, p.status,
         g.path as group_path,
         s.name as supplier_name,
         pb.status as branch_status,
         (select count(*) from product_branch x where x.product_id = p.id) as ranged_branches,
         pp.price_pence,
         u.per as price_per, u.divisor as price_divisor,
         (select count(distinct pp2.unit_of_measure_id)
            from product_price pp2 where pp2.product_id = p.id) as price_uom_count`;

const FROM = `
    from product p
    join product_group g on g.id = p.product_group_id
    left join supplier s on s.id = p.default_supplier_id
    left join product_branch pb on pb.product_id = p.id and pb.branch_id = ?
    left join product_price pp on pp.product_id = p.id and pp.tier = 1
    left join unit_of_measure u on u.id = pp.unit_of_measure_id`;

// Sequential `?` rather than numbered parameters. The numbered version worked but the
// indices had to be computed from how many name tokens were present — `?${4 + tokens.length}`
// — and every new clause shifted the arithmetic for the ones after it. Adding OFFSET to that
// was going to break something silently. With sequential placeholders the only rule is that
// params are pushed in the order the fragments appear in the finished SQL.

// What a counter can sell now, in the order they can sell it. not_permitted sinks to the
// bottom rather than being hidden: "why can I not find it" is worse than seeing it greyed.
const BY_AVAILABILITY = `
            case pb.status when 'core' then 0 when 'stocked' then 1
                           when 'non_stock' then 2
                           when 'not_permitted' then 9
                           else case when (select count(*) from product_branch x
                                            where x.product_id = p.id) > 0 then 3 else 4 end end`;

// Ordering lives in SQL rather than being re-sorted in JS after a LIMIT has already thrown
// the interesting rows away. `p.id` is the final tiebreak and is not decoration: without a
// total order, two rows tying on name can swap between pages, so a product is shown twice
// and another never at all. That only appears once paging exists, and looks like data loss.
function orderSql(browsing) {
  if (browsing) return ` order by${BY_AVAILABILITY}, p.name, p.id`;
  // An exact code beats everything — someone who typed a full code knows what they want —
  // then a code prefix, then a name hit.
  return ` order by case when lower(p.code) = lower(?) then 0
                 when lower(p.code) like lower(?) || '%' then 1
                 else 2 end,${BY_AVAILABILITY}, p.name, p.id`;
}

function matchClause(route, term, tokens) {
  if (route === "barcode") {
    return {
      sql: `(p.barcode_inner = ? or p.barcode_outer = ? or p.barcode_pallet = ?)`,
      params: [term, term, term],
    };
  }
  const parts = [`lower(p.code) like lower(?) || '%'`];
  const params = [term];
  if (tokens.length) {
    parts.push(`(${tokens.map(() => `p.name like ?`).join(" and ")})`);
    params.push(...tokens.map((t) => `%${t}%`));
  }
  return { sql: `(${parts.join(" or ")})`, params };
}

/**
 * Search the catalogue as seen from one branch, or browse it.
 *
 * scope "branch" restricts to what the branch ranges; "all" searches the whole catalogue and
 * reports each product's state at that branch anyway — which is what makes widening useful
 * rather than just longer.
 *
 * With no term but a group (or supplier) chosen, this browses instead of searching. A filter
 * that returns nothing until you also type something is a filter that looks broken: picking
 * "Top.Timber.Joinery.Sawn" is already a complete question.
 */
export function searchProducts({
  term = "",
  branchId = null,
  scope = "branch",
  groupPath = "",
  supplierId = null,
  limit = 20,
  offset = 0,
} = {}) {
  const routed = routeFor(term);
  const filtered = Boolean(groupPath || supplierId);
  // A bare empty box is not a browse — the cold-start hint is more use than page 1 of 3,714.
  // A filter is what turns it into one.
  const browsing = filtered && (routed.route === "none" || routed.route === "too_short");

  if (!browsing && (routed.route === "none" || routed.route === "too_short")) {
    return {
      route: routed.route, rows: [], total: 0, matchCount: 0,
      tookMs: 0, plan: [], warnings: [],
    };
  }

  // The minimum length guards the NAME search, not the route. A short code-ish term like
  // "04" is a useful prefix and costs an index seek; running `name like '%04%'` alongside it
  // is not the same search and not cheap — "pl" matched 525 products on two characters.
  // Measured on the whole term rather than per token, so "25 x 50" still works.
  const nameable = !browsing && routed.route !== "barcode" && routed.term.length >= MIN_NAME;
  const tokens = nameable ? tokensOf(routed.term) : [];

  const where = [];
  const whereParams = [];
  if (!browsing) {
    const match = matchClause(routed.route, routed.term, tokens);
    where.push(match.sql);
    whereParams.push(...match.params);
  }
  // Archived products are not sellable and are noise in a counter search.
  where.push(`p.status = 'active'`);
  if (scope === "branch") where.push(`pb.id is not null`);
  if (groupPath) {
    where.push(`(g.path = ? or g.path like ? || '.%')`);
    whereParams.push(groupPath, groupPath);
  }
  if (supplierId) {
    where.push(`p.default_supplier_id = ?`);
    whereParams.push(supplierId);
  }

  const whereSql = ` where ${where.join(" and ")}`;
  const order = orderSql(browsing);
  const orderParams = browsing ? [] : [routed.term, routed.term];

  // Params in the order the fragments appear: FROM, WHERE, ORDER BY, then the page window.
  const sql = `${SELECT}${FROM}${whereSql}${order} limit ? offset ?`;
  const result = measured("products." + (browsing ? "browse" : "search"), sql, [
    branchId ?? -1, ...whereParams, ...orderParams, Math.max(1, limit), Math.max(0, offset),
  ]);

  // How many matched, against how many came back. Reporting only the page is how a truncated
  // result gets mistaken for the whole answer — the same bug the customer search shipped
  // with. With paging it is also what the page count is computed from.
  const countSql = `select count(*) as c ${FROM}${whereSql}`;
  const matchCount = db.query(countSql).get(branchId ?? -1, ...whereParams)?.c ?? result.total;

  const rows = result.rows.map((row) => ({
    ...row,
    availability: availabilityOf(row),
    // A product priced more than one way cannot be summarised by one figure, and the counter
    // needs to know to open the detail rather than quote from the list.
    price_varies: row.price_uom_count > 1,
  }));

  return {
    ...result,
    rows,
    route: browsing ? "browse" : routed.route,
    matchCount,
    offset: Math.max(0, offset),
    truncated: matchCount > rows.length,
  };
}

// --- facets ------------------------------------------------------------------

// Every group that holds something *anywhere beneath it*, not just directly.
//
// Products hang off leaf groups, so counting them per group offers only the 91 leaves —
// `Top.Timber.Joinery.Sawn` but never `Top.Timber`. The parents are the useful browse
// targets ("show me all timber"), the subtree filter already supports them, and leaving them
// out of the list made a working feature unreachable from the UI.
//
// The counts are rolled up in JS rather than SQL. Doing the ancestor match as a self-join on
// the materialised path (`cg.path like g.path || '.%'`) is a 109x109 cross product against
// 3,714 products and measured 51 ms — ten times the harness warning threshold, for a facet
// that reloads on every branch change. Counting leaves is a single grouped scan, and rolling
// those up is ~12k string comparisons over 109 groups. A product belongs to exactly one
// group, so summing descendant counts is exact rather than an approximation.
const LEAF_GROUPS = `
  select g.id, g.path,
         count(distinct p.id) as product_count,
         count(distinct case when pb.id is not null then p.id end) as ranged_count
    from product_group g
    join product p on p.product_group_id = g.id and p.status = 'active'
    left join product_branch pb on pb.product_id = p.id and pb.branch_id = ?1
   group by g.id`;

export function listProductGroups(branchId = null) {
  const started = performance.now();
  const direct = measured("products.groups", LEAF_GROUPS, [branchId ?? -1]);
  const all = db.query(`select id, path, description, leaf from product_group order by path`).all();

  const rows = [];
  for (const g of all) {
    const prefix = `${g.path}.`;
    let product_count = 0;
    let ranged_count = 0;
    for (const d of direct.rows) {
      if (d.path === g.path || d.path.startsWith(prefix)) {
        product_count += d.product_count;
        ranged_count += d.ranged_count;
      }
    }
    // A group holding nothing anywhere beneath it is not a filter anybody wants offered.
    if (product_count > 0) rows.push({ ...g, product_count, ranged_count });
  }

  // Reported including the rollup, not just the SQL — the harness timing should be what the
  // caller actually waited for.
  return { ...direct, rows, total: rows.length, tookMs: Number((performance.now() - started).toFixed(2)) };
}

// Suppliers that supply something, with how much of it this branch ranges.
const SUPPLIERS = `
  select s.id, s.code, s.name,
         count(distinct p.id) as product_count,
         count(distinct case when pb.id is not null then p.id end) as ranged_count
    from supplier s
    join product p on p.default_supplier_id = s.id and p.status = 'active'
    left join product_branch pb on pb.product_id = p.id and pb.branch_id = ?1
   group by s.id
  having product_count > 0
   order by s.name`;

export function listProductSuppliers(branchId = null) {
  return measured("products.suppliers", SUPPLIERS, [branchId ?? -1]);
}

// What one branch ranges, in one line — shown in the harness so the scope control is
// legible: "1,608 of 3,714 ranged here" explains an empty branch-scoped result immediately.
export function rangeSummary(branchId) {
  return measured(
    "products.rangeSummary",
    `select
       (select count(*) from product where status = 'active') as catalogue,
       count(*) as ranged,
       sum(status = 'core') as core,
       sum(status = 'stocked') as stocked,
       sum(status = 'non_stock') as non_stock,
       sum(status = 'not_permitted') as not_permitted
     from product_branch where branch_id = ?1`,
    [branchId],
  );
}
