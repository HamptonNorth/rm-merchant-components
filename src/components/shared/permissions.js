// src/components/shared/permissions.js — the non-visual core of <merchant-user-permissions-view>.
//
// A head office user holds 430 grants across 29 branches. Rendered one row per grant that is
// a wall nobody reads, so the card collapses them. Two decisions drive everything here:
//
//   group by permission AND limit — a travelling rep may raise credit notes up to £600 at
//     their home branch and £300 away. That is two facts, not one, and merging them would
//     state something false. Same permission, same limit => one row.
//
//   describe branches by region, with exceptions — "All 4 North West branches" and "All
//     branches except Head Office" are how someone actually describes their own access.
//     Falling back to naming branches is always correct, just longer.
//
// Kept separate from the component so the collapsing can be tested without a DOM.

// Categories come from the dataset (permission.category). Labelled here because the raw
// codes are snake_case and the plural reads better in a heading.
const CATEGORY_LABELS = {
  sales: "Sales",
  pricing: "Pricing",
  credit: "Credit notes",
  purchasing: "Purchasing",
  stock: "Stock",
  works_order: "Works orders",
};

// Unknown categories are title-cased rather than dropped: a category added upstream should
// appear, imperfectly labelled, not vanish.
export function categoryLabel(code) {
  if (!code) return "Other";
  return CATEGORY_LABELS[code] ?? code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// en-GB list, no Oxford comma.
export function joinList(items) {
  const parts = items.filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// Below this, naming every branch is shorter and clearer than counting them: "Bristol and
// Exeter" beats "All 2 branches".
const COUNT_MIN_COVERED = 3;

// "All branches except Lancaster" only helps when there are more branches to skip than to
// name, and when there are enough of them that naming would be tedious.
const EXCEPT_MIN_COVERED = 4;
const EXCEPT_MAX_MISSING = 2;

/**
 * Describe a set of branches in the terms of the user's own coverage.
 *
 * @param branchIds ids the permission is held at, at one particular limit
 * @param coverage  every branch the user covers: { branch_id, branch_code, branch_name,
 *                  region_id, region_name }
 */
export function describeBranches(branchIds, coverage = []) {
  const held = new Set(branchIds.map(Number));
  if (!held.size) return "";

  const covered = coverage.map((c) => ({ ...c, branch_id: Number(c.branch_id) }));
  const byId = new Map(covered.map((c) => [c.branch_id, c]));
  // An id with no coverage row should be impossible — a grant at an uncovered branch fails
  // invariant 3 upstream — but show the id rather than a blank if it ever happens.
  const names = (ids) => ids.map((id) => byId.get(id)?.branch_name ?? `branch ${id}`);

  if (covered.length && held.size === covered.length) {
    return covered.length < COUNT_MIN_COVERED
      ? joinList(names([...held]))
      : `All ${covered.length} branches`;
  }

  // Whole regions collapse to one phrase; anything partial is named. Regions are small (3-4
  // branches) and a user covers at most one region plus head office unless they are head
  // office themselves, so the named remainder stays short in practice and is never truncated
  // — a permissions card that hides where a permission applies is worse than a long line.
  const regions = new Map();
  for (const c of covered) {
    const key = c.region_id ?? "unassigned";
    if (!regions.has(key)) regions.set(key, { name: c.region_name, covered: [], held: [] });
    const r = regions.get(key);
    r.covered.push(c.branch_id);
    if (held.has(c.branch_id)) r.held.push(c.branch_id);
  }

  const parts = [];
  const loose = [];
  for (const r of regions.values()) {
    if (!r.held.length) continue;
    if (r.name && r.covered.length > 1 && r.held.length === r.covered.length) {
      parts.push(`all ${r.covered.length} ${r.name} branches`);
    } else {
      loose.push(...r.held);
    }
  }
  if (loose.length) parts.push(joinList(names(loose)));

  // Regions first — that is how people describe their own patch — but only while the phrase
  // stays tidy. A head office user holding a permission at 28 of 29 branches decomposes into
  // seven whole regions and four stragglers, which nobody reads; "All branches except East
  // London" is the same fact in five words.
  const tidy = parts.length && parts.length <= 2 && loose.length <= 2;
  const missing = covered.filter((c) => !held.has(c.branch_id)).map((c) => c.branch_id);
  if (
    !tidy &&
    covered.length >= EXCEPT_MIN_COVERED &&
    missing.length &&
    missing.length <= EXCEPT_MAX_MISSING &&
    missing.length < held.size
  ) {
    return `All branches except ${joinList(names(missing))}`;
  }

  const sentence = joinList(parts) || joinList(names([...held]));
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * Collapse flat grant rows into categories → permissions → limit variants.
 *
 * Categories are built from what is HELD, so a category the user has nothing in never
 * appears — an empty "Purchasing" heading tells a counter assistant nothing.
 *
 * `dense: false` keeps the same shape and turns the collapsing off: one variant per branch,
 * named individually. The toggle then changes density only, never the card's structure, so
 * a row does not move when it is switched.
 */
export function groupGrants({ grants = [], coverage = [], dense = true } = {}) {
  const permissions = new Map();

  for (const g of grants) {
    const id = Number(g.permission_id);
    if (!permissions.has(id)) {
      permissions.set(id, {
        id,
        code: g.code,
        name: g.name,
        description: g.description,
        category: g.category,
        scope: g.scope,
        isLimited: Number(g.is_limited) === 1,
        sort: Number(g.sort) ?? 0,
        branchIds: [],
        variants: new Map(),
      });
    }
    const p = permissions.get(id);
    const branchId = Number(g.branch_id);
    p.branchIds.push(branchId);

    // NULL and 0 are different answers — no threshold at all, versus a threshold of nothing —
    // so the key must not conflate them. Undense, the branch itself is the key, which is what
    // splits a collapsed row back into one line per branch.
    const limit = g.approval_limit_pence == null ? null : Number(g.approval_limit_pence);
    const key = dense ? (limit == null ? "null" : String(limit)) : `b${branchId}`;
    if (!p.variants.has(key)) {
      p.variants.set(key, { limit, branchIds: [], label: `${g.branch_code} — ${g.branch_name}` });
    }
    p.variants.get(key).branchIds.push(branchId);
  }

  const shaped = [...permissions.values()].map((p) => ({
    ...p,
    variants: [...p.variants.values()]
      // Dense: the dominant limit leads — whichever applies at most branches is the one the
      // user thinks of as "their" limit. Undense: leave the server's region/code ordering.
      .sort((a, b) =>
        dense ? b.branchIds.length - a.branchIds.length || (b.limit ?? -1) - (a.limit ?? -1) : 0,
      )
      .map((v) => ({ ...v, where: dense ? describeBranches(v.branchIds, coverage) : v.label })),
  }));

  const categories = new Map();
  for (const p of shaped.sort((a, b) => a.sort - b.sort)) {
    const key = p.category ?? "other";
    if (!categories.has(key)) {
      categories.set(key, { code: key, label: categoryLabel(p.category), permissions: [] });
    }
    categories.get(key).permissions.push(p);
  }
  // Insertion order is already permission `sort` order, which is the catalogue's own
  // ordering — sales, pricing, credit, purchasing, stock, works orders.
  return [...categories.values()];
}

// Whether collapsing would actually change anything. Below this there is nothing to
// collapse, so the toggle is hidden rather than offered as a no-op.
export function isCollapsible(coverage = []) {
  return coverage.length > 1;
}
