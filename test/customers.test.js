// Routing for the trade-counter search. The routing table is the part most likely to break
// silently: it depends on the dataset's account-code shape, which is configurable upstream,
// and a wrong branch sends a term to a search that quietly returns nothing.

import { test, expect } from "bun:test";
import {
  routeFor,
  accountCodeShape,
  widenBranchIds,
  searchCustomers,
} from "../server/queries/customers.js";
import { db } from "../server/db.js";

const SLASHED = { slashed: true, numeric: false, maxPrefix: 2 };
const SLASHED3 = { slashed: true, numeric: false, maxPrefix: 3 };
const NUMERIC = { slashed: false, numeric: true, maxPrefix: 3 };

test("a single digit is a quick code under every account-code format", () => {
  for (const shape of [SLASHED, SLASHED3, NUMERIC]) {
    for (const d of ["1", "5", "9"]) {
      expect(routeFor(d, shape), `${d} under ${JSON.stringify(shape)}`).toMatchObject({
        route: "quick_code",
        quickCode: Number(d),
      });
    }
  }
  // 0 is not a quick code, and two digits is an account code, not a keypad press.
  expect(routeFor("0", SLASHED).route).toBe("too_short");
});

test("account codes route by the shape actually in the data, not a fixed pattern", () => {
  expect(routeFor("DK/", SLASHED).route).toBe("account_code");
  expect(routeFor("DK/0002", SLASHED).route).toBe("account_code");

  // Format 4 uses three leading letters. A rule hardcoded to two would send this to a name
  // search, which returns nothing and looks like "no such customer".
  expect(routeFor("CAS/00", SLASHED3).route).toBe("account_code");

  // Format 1 has no letters and no slash at all, so a numeric term IS the account code —
  // the opposite of what happens under the slashed formats.
  expect(routeFor("0027200", NUMERIC).route).toBe("account_code");
  expect(routeFor("0027200", SLASHED).route).toBe("name");
});

test("postcodes search from three characters, names from four", () => {
  // A UK outward code is often three characters. Requiring four would mean typing the space
  // before anything happened.
  expect(routeFor("SK4", SLASHED).route).toBe("postcode_then_name");
  expect(routeFor("B29", SLASHED).route).toBe("postcode_then_name");
  expect(routeFor("SK4 1DR", SLASHED).route).toBe("postcode_then_name");

  expect(routeFor("smi", SLASHED).route).toBe("too_short");
  expect(routeFor("smith", SLASHED).route).toBe("name");
});

test("a postcode-looking term still searches names — 'A1 Plumbing' is a trading name", async () => {
  // The route is postcode_then_name, not postcode-instead-of-name.
  expect(routeFor("A1 Plumbing", SLASHED).route).toBe("postcode_then_name");

  const branch = db.query(`select home_branch_id id, count(*) n from customer
                            group by 1 order by n desc limit 1`).get();
  const named = db.query(`select name from customer where home_branch_id = ?1
                           and name like 'A%' order by id limit 1`).get(branch.id);
  if (named) {
    const term = named.name.slice(0, 6);
    const result = searchCustomers({ term, workingBranchId: branch.id, scope: "branch" });
    expect(result.rows.some((r) => r.matched_on === "name")).toBe(true);
  }
});

test("the inferred shape matches the dataset that is actually loaded", () => {
  const shape = accountCodeShape();
  const sample = db.query(`select account_code from customer where account_code <> '' limit 1`).get();
  if (sample.account_code.includes("/")) {
    expect(shape.slashed).toBe(true);
    expect(shape.maxPrefix).toBeGreaterThanOrEqual(sample.account_code.indexOf("/"));
  } else {
    expect(shape.numeric).toBe(true);
  }
});

test("an account-code prefix containing a digit still routes to account code", () => {
  // Upstream builds the prefix from the customer's NAME, so "1st Choice Roofing" yields
  // 1S/0000635. A rule expecting letters there sends it to a name search that finds nothing,
  // and the customer looks as though they do not exist.
  const digitPrefixed = db.query(
    `select account_code, home_branch_id from customer
      where account_code glob '[0-9]*' and account_code like '%/%' limit 1`).get();
  if (!digitPrefixed) return; // shape-dependent; nothing to assert under other formats

  const prefix = digitPrefixed.account_code.slice(0, digitPrefixed.account_code.indexOf("/") + 1);
  expect(routeFor(prefix, accountCodeShape()).route).toBe("account_code");

  const result = searchCustomers({
    term: digitPrefixed.account_code,
    workingBranchId: digitPrefixed.home_branch_id,
  });
  expect(result.route).toBe("account_code");
  expect(result.rows.length).toBeGreaterThan(0);
});

test("widening adds the curated neighbours, not the region", () => {
  const branch = db.query(`select branch_id id from branch_neighbour group by 1
                            having count(*) >= 2 order by branch_id limit 1`).get();

  expect(widenBranchIds(branch.id, "branch")).toEqual([branch.id]);
  expect(widenBranchIds(branch.id, "all")).toBeNull();

  const near = widenBranchIds(branch.id, "neighbours");
  expect(near[0]).toBe(branch.id);
  expect(near.length).toBeGreaterThan(1);

  // The point of the curated table: at least one branch reaches outside its own region.
  const crossRegion = db.query(`
    select count(*) n from branch_neighbour bn
      join branch a on a.id = bn.branch_id
      join branch b on b.id = bn.neighbour_branch_id
     where a.region_id <> b.region_id`).get().n;
  expect(crossRegion).toBeGreaterThan(0);
});

test("national accounts are in scope even at branch level", () => {
  const nat = db.query(`select name, home_branch_id from customer
                         where is_national_account = 1 limit 1`).get();
  const otherBranch = db.query(`select id from branch
                                 where branch_type = 'trading' and id <> ?1 limit 1`)
    .get(nat.home_branch_id);

  const result = searchCustomers({
    term: nat.name.slice(0, 12),
    workingBranchId: otherBranch.id,
    scope: "branch",
  });
  expect(result.rows.some((r) => r.id && r.is_national_account === 1)).toBe(true);
});

test("a quick code resolves to one cash account owned by that branch", () => {
  const q = db.query(`select branch_id, quick_code from branch_quick_code
                       where quick_code = 1 order by branch_id limit 1`).get();
  const result = searchCustomers({ term: String(q.quick_code), workingBranchId: q.branch_id });

  expect(result.route).toBe("quick_code");
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].account_type).toBe("cash");
  expect(result.rows[0].home_branch_id).toBe(q.branch_id);
  expect(result.rows[0].matched_on).toBe("quick_code");
});

test("a postcode typed without its space still matches", () => {
  const row = db.query(`select postcode, home_branch_id from customer
                         where postcode like '% %' limit 1`).get();
  const squashed = row.postcode.replace(/\s+/g, "");

  const withSpace = searchCustomers({ term: row.postcode, workingBranchId: row.home_branch_id });
  const without = searchCustomers({ term: squashed, workingBranchId: row.home_branch_id });

  expect(withSpace.rows.length).toBeGreaterThan(0);
  expect(without.rows.length, `${squashed} should find what ${row.postcode} finds`).toBeGreaterThan(0);
});

test("every typed token must appear in the name, in any order", () => {
  // "gate build" has to find "Gates Building Services". Sending the whole term as one FTS
  // phrase looks for the literal string "gate build", which is not in that name, so the
  // customer appeared not to exist.
  const target = db.query(
    `select name, home_branch_id from customer
      where lower(name) like '%gate%' and lower(name) like '%build%' limit 1`).get();
  if (!target) return;

  const found = (term) =>
    searchCustomers({ term, workingBranchId: target.home_branch_id, scope: "all", limit: 50 })
      .rows.some((r) => r.name === target.name);

  expect(found("gate build"), "partial tokens").toBe(true);
  expect(found("build gate"), "order must not matter").toBe(true);
});

test("a name search does not match on town", () => {
  // The FTS table indexes name and town. Without a name: column filter, searching "gate"
  // returns every builder in Gateshead — noise for a search plainly about a company name.
  const town = db.query(
    `select town from customer where town <> '' group by town
      having count(*) > 20 order by count(*) desc limit 1`).get();
  const branch = db.query(
    `select home_branch_id id from customer where town = ?1 limit 1`).get(town.town);

  const result = searchCustomers({
    term: town.town,
    workingBranchId: branch.id,
    scope: "all",
    limit: 50,
  });
  for (const row of result.rows) {
    if (row.matched_on !== "name") continue;
    expect(
      row.name.toLowerCase().includes(town.town.toLowerCase().slice(0, 4)),
      `${row.name} matched on name but the term is the town ${town.town}`,
    ).toBe(true);
  }
});

test("tokens shorter than three characters still constrain the search", () => {
  // Trigram cannot index below three characters, so a short token goes to LIKE rather than
  // being dropped — "j smith" must still mean the name contains a j.
  const result = searchCustomers({ term: "j smith", workingBranchId: 1, scope: "all", limit: 25 });
  expect(result.rows.length).toBeGreaterThan(0);
  for (const row of result.rows) {
    const n = row.name.toLowerCase();
    expect(n.includes("smith"), row.name).toBe(true);
    expect(n.includes("j"), row.name).toBe(true);
  }
});
