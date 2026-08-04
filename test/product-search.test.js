// The catalogue search behind <merchant-find-product>. Two halves: routing and availability
// as pure functions, then the same behaviour against the real 47,704-row product_branch,
// where "not ranged here" is the common case rather than an edge one.

import { test, expect } from "bun:test";
import {
  routeFor,
  availabilityOf,
  searchProducts,
  listProductGroups,
  rangeSummary,
  AVAILABILITY,
} from "../server/queries/product-search.js";
import { db } from "../server/db.js";

// A branch that ranges plenty, and one product each side of the ranging line, taken from the
// data rather than hardcoded so a regeneration does not silently invalidate the test.
const BRANCH = db
  .query(`select branch_id, count(*) c from product_branch group by 1 order by c desc limit 1`)
  .get().branch_id;

const heldHere = db
  .query(
    `select p.code, p.name from product_branch pb join product p on p.id = pb.product_id
      where pb.branch_id = ? and pb.status in ('core','stocked') limit 1`,
  )
  .get(BRANCH);

const blocked = db
  .query(
    `select pb.branch_id, p.code from product_branch pb join product p on p.id = pb.product_id
      where pb.status = 'not_permitted' limit 1`,
  )
  .get();

// --- routing -----------------------------------------------------------------

test("routeFor separates a scan from a code from a name", () => {
  expect(routeFor("5055149904301").route).toBe("barcode");
  expect(routeFor("0442BBBPLY").route).toBe("search");
  expect(routeFor("birch ply").route).toBe("search");
  expect(routeFor("").route).toBe("none");
  expect(routeFor("x").route).toBe("too_short");
});

test("a long run of digits is a scan regardless of exact length", () => {
  // Nothing should depend on EAN-13 specifically — a scanner is a scanner.
  for (const n of [8, 12, 13, 14]) {
    expect(routeFor("9".repeat(n)).route, `${n} digits`).toBe("barcode");
  }
  expect(routeFor("9".repeat(7)).route).not.toBe("barcode");
});

// --- availability ------------------------------------------------------------

test("availabilityOf maps every ranging state, and absence is not an error", () => {
  expect(availabilityOf({ branch_status: "core", ranged_branches: 5 })).toBe("held");
  expect(availabilityOf({ branch_status: "stocked", ranged_branches: 5 })).toBe("held");
  expect(availabilityOf({ branch_status: "non_stock", ranged_branches: 5 })).toBe("to_order");
  expect(availabilityOf({ branch_status: "not_permitted", ranged_branches: 5 })).toBe("blocked");
  // No ranging row is the COMMON case: not ranged here, still sellable.
  expect(availabilityOf({ branch_status: null, ranged_branches: 12 })).toBe("elsewhere");
  expect(availabilityOf({ branch_status: null, ranged_branches: 0 })).toBe("special_order");
});

test("only 'blocked' is unsellable — the rest are all a yes with different logistics", () => {
  const sellable = Object.entries(AVAILABILITY).filter(([, v]) => v.sellable).map(([k]) => k);
  expect(sellable.sort()).toEqual(["elsewhere", "held", "special_order", "to_order"]);
  expect(AVAILABILITY.blocked.sellable).toBe(false);
});

// --- against the real dataset ------------------------------------------------

test("name tokens match in any order", () => {
  const a = searchProducts({ term: "birch ply", branchId: BRANCH, scope: "all" });
  const b = searchProducts({ term: "ply birch", branchId: BRANCH, scope: "all" });
  expect(a.matchCount).toBeGreaterThan(0);
  expect(b.matchCount).toBe(a.matchCount);
  expect(b.rows.map((r) => r.code)).toEqual(a.rows.map((r) => r.code));
});

test("a short code-ish term does not trigger a name scan", () => {
  // "pl" once returned 525 products, because the minimum length guarded the route rather
  // than the name clause. A two-character term must only be a code prefix.
  const r = searchProducts({ term: "pl", branchId: BRANCH, scope: "all", limit: 500 });
  expect(r.matchCount).toBeLessThan(50);
  for (const row of r.rows) {
    expect(row.code.toLowerCase().startsWith("pl"), `${row.code} is not a pl* code`).toBe(true);
  }
  // But a term long enough for a name still searches names.
  const named = searchProducts({ term: "ply", branchId: BRANCH, scope: "all", limit: 500 });
  expect(named.rows.some((row) => !row.code.toLowerCase().startsWith("ply"))).toBe(true);
});

test("branch scope returns only ranged lines; widening returns more and still states them", () => {
  const term = "birch ply";
  const scoped = searchProducts({ term, branchId: BRANCH, scope: "branch", limit: 500 });
  const all = searchProducts({ term, branchId: BRANCH, scope: "all", limit: 500 });

  expect(all.matchCount).toBeGreaterThanOrEqual(scoped.matchCount);
  // Everything in a branch-scoped result is ranged at that branch, by definition.
  for (const row of scoped.rows) {
    expect(["held", "to_order", "blocked"], `${row.code} -> ${row.availability}`).toContain(
      row.availability,
    );
  }
  // Widening still answers "and what about here?" for every row — that is what makes it
  // useful rather than merely longer.
  for (const row of all.rows) {
    expect(Object.keys(AVAILABILITY)).toContain(row.availability);
  }
});

test("every row carries its price unit, because 266 products change unit between tiers", () => {
  const r = searchProducts({ term: "ply", branchId: BRANCH, scope: "all", limit: 50 });
  for (const row of r.rows) {
    if (row.price_pence === null) continue;
    expect(row.price_per, `${row.code} has a price but no unit`).toBeTruthy();
    expect(typeof row.price_varies).toBe("boolean");
  }
  // The multi-unit products exist and are flagged; if this ever hits zero the flag is dead
  // code and the "+" marker in the UI is lying by omission.
  const multi = db
    .query(
      `select count(*) c from (select product_id from product_price
         group by product_id having count(distinct unit_of_measure_id) > 1)`,
    )
    .get().c;
  expect(multi).toBeGreaterThan(0);
});

test("a blocked line is found and reported, not hidden", () => {
  // Hiding it produces "why can I not find it", which is worse at a counter than seeing it
  // greyed with a reason. The component refuses selection; the query still returns it.
  const r = searchProducts({ term: blocked.code, branchId: blocked.branch_id, scope: "all" });
  const row = r.rows.find((x) => x.code === blocked.code);
  expect(row).toBeTruthy();
  expect(row.availability).toBe("blocked");
});

test("held lines sort above lines that have to be fetched", () => {
  const r = searchProducts({ term: "ply", branchId: BRANCH, scope: "all", limit: 500 });
  const rank = (a) => AVAILABILITY[a].rank;
  // Ordering happens in SQL, so it survives the LIMIT. Codes matching the term exactly are
  // allowed to jump the queue, so compare only within the name-matched tail.
  const tail = r.rows.filter((row) => !row.code.toLowerCase().startsWith("ply"));
  for (let i = 1; i < tail.length; i++) {
    expect(
      rank(tail[i].availability) >= rank(tail[i - 1].availability),
      `${tail[i - 1].code}(${tail[i - 1].availability}) then ${tail[i].code}(${tail[i].availability})`,
    ).toBe(true);
  }
});

test("an exact code beats a name hit", () => {
  const r = searchProducts({ term: heldHere.code, branchId: BRANCH, scope: "all", limit: 25 });
  expect(r.rows[0].code).toBe(heldHere.code);
});

test("matchCount reports the whole answer, not the page", () => {
  const limited = searchProducts({ term: "timber", branchId: BRANCH, scope: "all", limit: 3 });
  const full = searchProducts({ term: "timber", branchId: BRANCH, scope: "all", limit: 500 });
  expect(limited.rows.length).toBeLessThanOrEqual(3);
  expect(limited.matchCount).toBe(full.matchCount);
  expect(limited.truncated).toBe(full.matchCount > limited.rows.length);
});

test("archived products never appear", () => {
  const r = searchProducts({ term: "a", branchId: BRANCH, scope: "all", limit: 500 });
  for (const row of r.rows) expect(row.status).toBe("active");
});

test("the group facet offers only groups holding something", () => {
  const groups = listProductGroups(BRANCH);
  expect(groups.rows.length).toBeGreaterThan(0);
  for (const g of groups.rows) {
    expect(g.product_count).toBeGreaterThan(0);
    expect(g.ranged_count).toBeLessThanOrEqual(g.product_count);
  }
});

test("the group filter includes the whole subtree", () => {
  const parent = "Top.Timber";
  const r = searchProducts({ term: "timber", branchId: BRANCH, scope: "all", groupPath: parent, limit: 500 });
  expect(r.rows.length).toBeGreaterThan(0);
  for (const row of r.rows) {
    expect(row.group_path === parent || row.group_path.startsWith(`${parent}.`)).toBe(true);
  }
  // A subtree must actually be deeper than the node itself, or the LIKE is doing nothing.
  expect(r.rows.some((row) => row.group_path.startsWith(`${parent}.`))).toBe(true);
});

test("the range summary explains an empty branch-scoped search", () => {
  const s = rangeSummary(BRANCH).rows[0];
  expect(s.ranged).toBeGreaterThan(0);
  expect(s.ranged).toBeLessThan(s.catalogue);
  expect(s.core + s.stocked + s.non_stock + s.not_permitted).toBe(s.ranged);
});
