// Routing for the trade-counter search. The routing table is the part most likely to break
// silently: it depends on the dataset's account-code shape, which is configurable upstream,
// and a wrong branch sends a term to a search that quietly returns nothing.

import { test, expect } from "bun:test";
import {
  routeFor,
  accountCodeShape,
  widenBranchIds,
  searchCustomers,
  nameQuery,
  equivalents,
  fuzzySearch,
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
  expect(routeFor("0027200", SLASHED).route).toBe("name_then_address");
});

test("postcodes search from three characters, names from four", () => {
  // A UK outward code is often three characters. Requiring four would mean typing the space
  // before anything happened.
  expect(routeFor("SK4", SLASHED).route).toBe("postcode_then_name");
  expect(routeFor("B29", SLASHED).route).toBe("postcode_then_name");
  expect(routeFor("SK4 1DR", SLASHED).route).toBe("postcode_then_name");

  expect(routeFor("smi", SLASHED).route).toBe("too_short");
  expect(routeFor("smith", SLASHED).route).toBe("name_then_address");
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

// --- abbreviations, suffixes and spelling variants ---------------------------

test("a legal-form suffix never excludes — adding a word must not lose matches", () => {
  // The failure this fixes: tokens are ANDed, so typing "ltd" used to drop every record
  // spelled "Limited". Measured, a search fell from 34 results to 11 by adding a word.
  const target = db.query(`select name, home_branch_id from customer
                            where name like '%Limited' limit 1`).get();
  const stem = target.name.split(" ")[0];

  const bare = searchCustomers({ term: stem, workingBranchId: target.home_branch_id, scope: "all", limit: 100 });
  for (const suffix of ["ltd", "ltd.", "limited", "plc", "co"]) {
    const withSuffix = searchCustomers({
      term: `${stem} ${suffix}`,
      workingBranchId: target.home_branch_id,
      scope: "all",
      limit: 100,
    });
    expect(withSuffix.matchCount, `"${stem} ${suffix}" must not lose matches`).toBe(bare.matchCount);
  }
});

test("searching only a legal form still requires it", () => {
  // Otherwise nothing at all would be required and the query would match everything.
  const q = nameQuery("ltd");
  expect(q.long.map((t) => t.norm)).toEqual(["ltd"]);
  expect(q.optional).toHaveLength(0);
});

test("nameQuery separates distinctive tokens from legal forms", () => {
  const q = nameQuery("N.R. Willis Limited");
  expect(q.long.map((t) => t.norm)).toEqual(["n.r", "willis"]);
  expect(q.optional.map((t) => t.norm)).toEqual(["limited"]);

  // Only leading and trailing punctuation is stripped, so "N.R." keeps its inner dot and
  // matches records spelled that way. Typing "NR Willis" therefore does NOT find "N.R.
  // Willis" — fixing that means normalising punctuation in the index too, which is built
  // upstream. Recorded rather than half-fixed here.
  expect(nameQuery("nr willis").long.map((t) => t.norm)).toEqual(["willis"]);
});

test("Mc and Mac find each other, generated rather than listed", () => {
  expect(equivalents("mcpherson").sort()).toEqual(["macpherson", "mcpherson"]);
  expect(equivalents("macleod").sort()).toEqual(["macleod", "mcleod"]);

  const branch = db.query(`select id from branch where branch_type='trading' limit 1`).get().id;
  const mc = searchCustomers({ term: "mcpherson", workingBranchId: branch, scope: "all", limit: 100 });
  const mac = searchCustomers({ term: "macpherson", workingBranchId: branch, scope: "all", limit: 100 });
  expect(mc.matchCount).toBe(mac.matchCount);
  expect(mc.matchCount).toBeGreaterThan(0);
});

test("street types match in both directions", () => {
  // Substring matching gets one direction free — "ave" is inside "Avenue" — but "rd" is
  // nowhere inside "Road", so both have to be expanded.
  expect(equivalents("lane")).toContain("ln");
  expect(equivalents("ln")).toContain("lane");
  expect(equivalents("road")).toContain("rd");
  expect(equivalents("rd")).toContain("road");

  const row = db.query(`select address_1, home_branch_id from customer
                         where address_1 like '% Lane' limit 1`).get();
  const words = row.address_1.split(" ");
  const street = words.slice(-2).join(" ");
  const abbreviated = `${words[words.length - 2]} Ln`;

  const full = searchCustomers({ term: street, workingBranchId: row.home_branch_id, scope: "all", limit: 50 });
  const short = searchCustomers({ term: abbreviated, workingBranchId: row.home_branch_id, scope: "all", limit: 50 });

  expect(full.matchCount).toBeGreaterThan(0);
  expect(short.matchCount, `"${abbreviated}" should find what "${street}" finds`).toBe(full.matchCount);
  expect(full.rows[0].matched_on).toBe("address");
});

test("a multi-token search containing an expanded token still parses", () => {
  // FTS5 accepts implicit AND between bare terms but not before a parenthesised OR group:
  // `name:"a" name:("b" OR "c")` is a syntax error. Single-word Mc/Mac worked and hid this.
  const branch = db.query(`select id from branch where branch_type='trading' limit 1`).get().id;
  for (const term of ["stead lane", "john mcbride", "green road builders"]) {
    expect(() =>
      searchCustomers({ term, workingBranchId: branch, scope: "all", limit: 10 }),
    ).not.toThrow();
  }
});

test("address only runs when the cheaper routes have not filled the page", () => {
  // It is a full scan at ~3.4ms. For a common term it would cost that to add nothing.
  const branch = db.query(`select id from branch where branch_type='trading' limit 1`).get().id;
  const common = searchCustomers({ term: "builders", workingBranchId: branch, scope: "all", limit: 25 });

  expect(common.rows).toHaveLength(25);
  expect(common.rows.every((r) => r.matched_on !== "address")).toBe(true);
  expect(common.plan.join(" ")).not.toContain("address_1");
});

// --- did-you-mean --------------------------------------------------------------

test("a typo recovers the right customer", () => {
  // Trigram substring matching is unforgiving: one transposed letter takes "builders" from
  // 1,450 matches to nought. Counter staff type fast and spell approximately.
  const branch = db.query(`select home_branch_id id, count(*) n from customer
                            group by 1 order by n desc limit 1`).get().id;

  for (const [typo, want] of [
    ["buidlers", "builders"],
    ["bulders", "builders"],
    ["biulders", "builders"],
    ["arowsmith", "arrowsmith"],
  ]) {
    const exact = searchCustomers({ term: typo, workingBranchId: branch, scope: "branch", limit: 25 });
    expect(exact.suggested, `"${typo}" should fall back`).toBe(true);
    expect(
      exact.rows[0].name.toLowerCase().includes(want),
      `"${typo}" -> ${exact.rows[0]?.name}`,
    ).toBe(true);
    expect(exact.rows[0].matched_on).toBe("similar");
  }
});

test("the fallback never runs alongside real results", () => {
  // What makes it safe: it cannot dilute a good result set because it only fires when there
  // is nothing on screen.
  const branch = db.query(`select home_branch_id id, count(*) n from customer
                            group by 1 order by n desc limit 1`).get().id;
  const good = searchCustomers({ term: "builders", workingBranchId: branch, scope: "branch", limit: 25 });

  expect(good.suggested).toBe(false);
  expect(good.rows.every((r) => r.matched_on !== "similar")).toBe(true);
  expect(good.rows.every((r) => r.edits === undefined)).toBe(true);
});

test("a term that resembles nothing returns nothing, not noise", () => {
  const branch = db.query(`select id from branch where branch_type='trading' limit 1`).get().id;
  const none = searchCustomers({ term: "zzzznothinglikethis", workingBranchId: branch, scope: "branch" });
  expect(none.rows).toHaveLength(0);
  expect(none.suggested).toBe(false);
});

test("distance is measured per word, not against the whole name", () => {
  // Two earlier attempts compared the query to the entire name and both let length dominate.
  // Dice rejected "FSS Painters and Decorators Limited" for "paintr" at 0.195 — the query
  // matched one word almost exactly, but a long name has many trigrams — and offered "Zain
  // Patel", which shares " pa" and "ain" by coincidence.
  const branch = db.query(`select home_branch_id id, count(*) n from customer
                            group by 1 order by n desc limit 1`).get().id;

  const { rows } = fuzzySearch("paintr", [branch], 8);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].name.toLowerCase()).toContain("painter");
  // A long company name must not be penalised for its length.
  expect(rows.some((r) => r.name.length > 30)).toBe(true);

  for (let i = 1; i < rows.length; i++) {
    expect(rows[i - 1].edits).toBeLessThanOrEqual(rows[i].edits);
  }
});

test("a transposition costs one edit, not two", () => {
  // Swapping adjacent keys is the commonest typing error. Under plain Levenshtein "smiht"
  // scores 2 against both "smith" and "swift", the tie breaks arbitrarily, and the counter
  // is shown H.T. Swift Mechanical Services.
  const branch = db.query(`select home_branch_id id, count(*) n from customer
                            group by 1 order by n desc limit 1`).get().id;

  for (const [typo, want] of [["smiht", "smith"], ["buidlers", "builders"], ["biulders", "builders"]]) {
    const { rows } = fuzzySearch(typo, [branch], 5);
    expect(rows.length, typo).toBeGreaterThan(0);
    expect(rows[0].name.toLowerCase(), `${typo} -> ${rows[0].name}`).toContain(want);
    expect(rows[0].edits, `${typo} should be one edit away`).toBe(1);
  }
});

test("an unrelated word of similar length is not offered", () => {
  const branch = db.query(`select home_branch_id id, count(*) n from customer
                            group by 1 order by n desc limit 1`).get().id;
  // "paintr" vs "patel" is 4 edits and "paintr" vs "zain" is 3 — neither should appear.
  const { rows } = fuzzySearch("paintr", [branch], 8);
  expect(rows.every((r) => !r.name.toLowerCase().includes("patel"))).toBe(true);
});
