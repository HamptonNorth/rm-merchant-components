// server/queries/customers.js — the trade-counter customer search.
//
// One text box, routed by what was typed (docs/plan.md §9). Routing happens here rather than
// in the component because the account-code shape is a property of the dataset, not of the
// UI: datagenerator2 emits four formats and they share no pattern.

import { measured, db } from "../db.js";

const SELECT_CUSTOMER = `
  select c.id, c.account_code, c.name, c.town, c.postcode,
         c.home_branch_id, c.account_type, c.credit_status,
         c.is_national_account, c.is_counter_account,
         b.code as branch_code, b.name as branch_name
    from customer c
    left join branch b on b.id = c.home_branch_id`;

// --- account code shape ------------------------------------------------------
//
// Inferred from the data, never hardcoded. `account_code_format` upstream produces
// 9999999, XX/999999, XX/9999999 or XXX/999999, so a rule keyed on "two letters then a
// slash" breaks under format 4 and matches nothing under format 1. Inference also copes with
// a dataset holding more than one shape after a change of convention, which a single
// recorded setting could not.
let shapeCache = null;

export function accountCodeShape() {
  if (shapeCache) return shapeCache;
  const rows = db
    .query(`select account_code from customer where account_code <> '' limit 500`)
    .all();

  let slashed = 0;
  let numeric = 0;
  let maxPrefix = 0;
  for (const { account_code: code } of rows) {
    // The prefix is NOT always letters. Upstream takes the first characters of the
    // customer's name, so "1st Choice Roofing" yields 1S/0000635 — a rule expecting
    // [A-Za-z] there sends that account to a name search that finds nothing.
    const m = /^([^/]+)\/\d+$/.exec(code);
    if (m) {
      slashed++;
      maxPrefix = Math.max(maxPrefix, m[1].length);
    } else if (/^\d+$/.test(code)) {
      numeric++;
    }
  }
  shapeCache = { slashed: slashed > 0, numeric: numeric > 0, maxPrefix: maxPrefix || 3, sampled: rows.length };
  return shapeCache;
}

const POSTCODE_START = /^[A-Za-z]{1,2}\d/;

// Which search a typed term should run. Exported so the route can report it and the tests
// can assert it without going through HTTP.
export function routeFor(term, shape = accountCodeShape()) {
  const t = term.trim();
  if (!t) return { route: "none" };

  // A single digit is always a quick code: the numeric account format is seven digits, so
  // length alone separates them.
  if (/^[1-9]$/.test(t)) return { route: "quick_code", quickCode: Number(t) };

  // Alphanumeric prefix, because the upstream prefix comes from the customer's name and can
  // start with a digit. The slash is what makes this unambiguous either way.
  if (shape.slashed && new RegExp(`^[A-Za-z0-9]{1,${shape.maxPrefix}}/`).test(t)) {
    return { route: "account_code" };
  }
  // With no letters and no slash there is nothing else a numeric term can be.
  if (shape.numeric && /^\d{2,}$/.test(t)) return { route: "account_code" };

  // Postcode-looking terms search postcode AND name, not postcode instead of name: "A1
  // Plumbing" starts like a postcode but is somebody's trading name.
  //
  // Three characters is enough for these where four is the floor elsewhere. A UK outward
  // code is often three ("SK4", "CH1", "B29"), and requiring four would mean typing the
  // space or part of the inward code before anything happened — at a counter that reads as
  // the search being broken. It is affordable because the postcode prefix is an indexed
  // seek (~0.02 ms), where a three-character name search would return half the branch.
  if (POSTCODE_START.test(t) && t.length >= 3) return { route: "postcode_then_name" };

  return t.length < 4 ? { route: "too_short" } : { route: "name_then_address" };
}

// --- scope -------------------------------------------------------------------

export function widenBranchIds(workingBranchId, scope) {
  if (scope === "all") return null; // no branch restriction
  if (scope === "neighbours") {
    const rows = db
      .query(
        `select neighbour_branch_id as id from branch_neighbour
          where branch_id = ?1 order by seq`,
      )
      .all(workingBranchId);
    return [workingBranchId, ...rows.map((r) => r.id)];
  }
  return [workingBranchId];
}

// National accounts are always in scope regardless of branch — they are not really
// branch-owned (docs/plan.md §0).
function scopeClause(branchIds, params) {
  if (!branchIds) return "";
  const start = params.length;
  params.push(...branchIds);
  const placeholders = branchIds.map((_, i) => `?${start + i + 1}`).join(", ");
  return ` and (c.home_branch_id in (${placeholders}) or c.is_national_account = 1)`;
}

// --- the searches ------------------------------------------------------------

function quickCodeSearch(workingBranchId, quickCode) {
  return measured(
    "customers.quickCode",
    `${SELECT_CUSTOMER}
       join branch_quick_code q on q.customer_id = c.id
      where q.branch_id = ?1 and q.quick_code = ?2`,
    [workingBranchId, quickCode],
  );
}

// How many rows the predicate matches in total, not just how many were returned. Measured at
// ~0.9 ms over 2,169 matches — cheaper than fetching the page itself, and without it a capped
// result set is indistinguishable from a complete one.
function countMatches(join, where, params) {
  return db.query(`select count(*) as c from customer c${join} where ${where}`).get(...params).c;
}

function accountCodeSearch(term, branchIds, limit) {
  const params = [`${term}%`];
  const scope = scopeClause(branchIds, params);
  const where = `c.account_code like ?1${scope}`;
  const matchCount = countMatches("", where, params);
  params.push(limit);
  return {
    ...measured(
      "customers.accountCode",
      `${SELECT_CUSTOMER} where ${where} order by c.account_code limit ?${params.length}`,
      params,
    ),
    matchCount,
  };
}

// UK postcodes are stored with the space ("SK4 1DR"), and counter staff often type without
// one. Trying both prefixes costs two indexed seeks at ~0.02 ms each.
function postcodeVariants(term) {
  const t = term.trim().toUpperCase();
  const variants = [t];
  if (!t.includes(" ") && t.length >= 5) {
    variants.push(`${t.slice(0, -3)} ${t.slice(-3)}`);
  }
  return variants;
}

function postcodeSearch(term, branchIds, limit) {
  const variants = postcodeVariants(term);
  const params = variants.map((v) => `${v}%`);
  const like = variants.map((_, i) => `c.postcode like ?${i + 1}`).join(" or ");
  const scope = scopeClause(branchIds, params);
  const where = `(${like})${scope}`;
  const matchCount = countMatches("", where, params);
  params.push(limit);
  return {
    ...measured(
      "customers.postcode",
      `${SELECT_CUSTOMER} where ${where} order by c.postcode limit ?${params.length}`,
      params,
    ),
    matchCount,
  };
}

// --- token handling ----------------------------------------------------------
//
// Three separate problems wear the same coat here, and only one of them is a synonym.
//
// 1. Legal-form words. 18,896 customers are spelled "Limited" and 16,387 "Ltd"/"Ltd.".
//    Because tokens are ANDed, typing "ltd" used to EXCLUDE every "Limited" record —
//    measured, a search went from 34 results to 11 by adding a word. These carry almost no
//    discriminating power ("Ltd" alone matches 16k customers), so the fix is not to make
//    them equivalent but to stop requiring them. That also covers the 10,576 customers with
//    no legal form at all, which no synonym pair can.
//
// 2. Spelling variants. Mc/Mac is a real equivalence — 964 against 277 — and it is one
//    rule, not an open-ended table.
//
// 3. Street-type abbreviations. Only relevant to the address route below.
const LEGAL_FORMS = new Set([
  "ltd", "limited", "plc", "llp", "co", "company", "inc", "incorporated", "llc",
  "and", "the",
]);

// Kept in code rather than a table: this is search behaviour, not merchant data, and a
// table would have to live upstream in datagenerator2 and need a regeneration to edit.
const EQUIVALENTS = [
  ["road", "rd"],
  ["lane", "ln"],
  ["avenue", "ave", "av"],
  ["street", "st"],
  ["close", "cl"],
  ["drive", "dr"],
  ["court", "ct"],
  ["place", "pl"],
  ["crescent", "cres"],
  ["gardens", "gdns"],
  ["terrace", "terr"],
  ["saint", "st"],
];

const EQUIV_INDEX = new Map();
for (const group of EQUIVALENTS) {
  for (const form of group) {
    EQUIV_INDEX.set(form, [...new Set([...(EQUIV_INDEX.get(form) ?? []), ...group])]);
  }
}

function normaliseToken(token) {
  return token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

// Every spelling a token should also match. Mc/Mac is generated rather than listed, so
// McPherson, McBride and MacLeod all work without an entry each.
export function equivalents(token) {
  const forms = new Set([token]);
  for (const f of EQUIV_INDEX.get(token) ?? []) forms.add(f);
  const mc = /^ma?c(.{2,})$/.exec(token);
  if (mc) {
    forms.add(`mc${mc[1]}`);
    forms.add(`mac${mc[1]}`);
  }
  return [...forms];
}

function ftsToken(token) {
  const forms = equivalents(token).map((f) => `"${f.replace(/"/g, '""')}"`);
  return forms.length > 1 ? `(${forms.join(" OR ")})` : forms[0];
}

export function nameQuery(term) {
  const tokens = term
    .trim()
    .split(/\s+/)
    .map((raw) => ({ raw, norm: normaliseToken(raw) }))
    .filter((t) => t.norm);

  const distinctive = tokens.filter((t) => !LEGAL_FORMS.has(t.norm));
  // Someone searching only "ltd" means it; otherwise nothing would be required at all.
  const required = distinctive.length ? distinctive : tokens;

  return {
    long: required.filter((t) => t.norm.length >= 3),
    short: required.filter((t) => t.norm.length < 3),
    optional: tokens.filter((t) => !required.includes(t)),
  };
}

// Name goes through FTS. Trigram matches substrings, so each token finds a partial word.
//
// Scoped to `name:` because the FTS table also indexes town, and without the column filter
// "gate" matches Gateshead — every builder in Gateshead came back for a search that was
// plainly about a company name.
function nameSearch(term, branchIds, limit) {
  const { long, short } = nameQuery(term);
  if (!long.length && !short.length) return { ...measured("customers.name", `${SELECT_CUSTOMER} where 0`, []), matchCount: 0 };

  const params = [];
  const where = [];
  let join = "";

  if (long.length) {
    // Explicit AND, not whitespace: FTS5 accepts implicit AND between bare terms but not
    // before a parenthesised OR group, so `name:"a" name:("b" OR "c")` is a syntax error
    // while `name:"a" AND name:("b" OR "c")` is fine. Only bites when a multi-token query
    // contains an expanded token, which is why single-word Mc/Mac worked and "stead lane"
    // did not.
    params.push(long.map((t) => `name:${ftsToken(t.norm)}`).join(" AND "));
    join = " join customer_fts f on f.rowid = c.id";
    where.push(`customer_fts match ?${params.length}`);
  }
  for (const token of short) {
    params.push(`%${token.norm}%`);
    where.push(`c.name like ?${params.length}`);
  }

  const scope = scopeClause(branchIds, params);
  const whereSql = `${where.join(" and ")}${scope}`;
  const matchCount = countMatches(join, whereSql, params);

  // Names containing the term as typed lead — so "smith ltd" puts an actual "Smith Ltd"
  // above a "Smith Limited" that only matched because the suffix stopped being required.
  params.push(term.trim());
  const fullTerm = params.length;
  params.push(limit);

  return {
    ...measured(
      "customers.name",
      `${SELECT_CUSTOMER}${join}
        where ${whereSql}
        order by (instr(lower(c.name), lower(?${fullTerm})) > 0) desc, c.name
        limit ?${params.length}`,
      params,
    ),
    matchCount,
  };
}

// Address is its own route, labelled `address` in matched_on, because a match on the street
// somebody is standing on means something different from a match on the company name.
//
// LIKE rather than FTS: address_1/address_2 are not in the FTS index, which is built
// upstream. Measured at 3.4 ms worst case over 39,452 rows and 1.5 ms branch-scoped, which
// is affordable — but it is a full scan, so at ~400k rows it becomes ~34 ms and the columns
// want adding to customer_fts upstream. Recorded in docs/upstream-requests.md.
function addressSearch(term, branchIds, limit) {
  const tokens = term
    .trim()
    .split(/\s+/)
    .map(normaliseToken)
    .filter((t) => t.length >= 2);
  if (!tokens.length) return { rows: [], matchCount: 0, tookMs: 0, plan: [], warnings: [] };

  const params = [];
  const where = [];
  for (const token of tokens) {
    // Substring matching gets abbreviation-to-full free in one direction only: "ave" is
    // inside "Avenue", but "rd" is nowhere inside "Road". So both directions are expanded.
    const alts = equivalents(token).map((form) => {
      params.push(`%${form}%`);
      return `(c.address_1 like ?${params.length} or c.address_2 like ?${params.length})`;
    });
    where.push(`(${alts.join(" or ")})`);
  }

  const scope = scopeClause(branchIds, params);
  const whereSql = `${where.join(" and ")}${scope}`;
  const matchCount = countMatches("", whereSql, params);
  params.push(limit);

  return {
    ...measured(
      "customers.address",
      `${SELECT_CUSTOMER} where ${whereSql} order by c.address_1 limit ?${params.length}`,
      params,
    ),
    matchCount,
  };
}

// --- did-you-mean fallback ---------------------------------------------------
//
// Counter staff type fast and spell approximately, and trigram substring matching is
// unforgiving: one transposed letter takes "builders" from 1,450 matches to nought. Measured
// against real typos, every one of buidlers / bulders / buillders / builers returns zero.
//
// This runs ONLY when the ordinary search found nothing, which is what makes it safe. The
// usual objection to fuzzy matching — that it trades precision for recall — does not apply
// when there is nothing on screen to dilute. It cannot make a good result worse because it
// never runs alongside one.
//
// Shortening the term to a prefix was the cheaper option and is not good enough: it recovers
// a dropped letter but an early transposition ("biulders" -> "biu") finds one confidently
// wrong customer, which is worse than finding none.

// Dice, not shared/max. The obvious denominator penalises long names for being long:
// "arowsmith" scored "Sharon Smith" above "K.W. Arrowsmith Co. Ltd.", and "biulders"
// returned "James Saunders". Dice balances overlap against combined length and got all four
// test typos right where the first attempt got two wrong.
const FUZZY_MIN_SCORE = 0.25;
const FUZZY_MAX_SUGGESTIONS = 8;

function trigrams(value) {
  const clean = ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const out = new Set();
  for (let i = 0; i + 3 <= clean.length; i++) out.add(clean.slice(i, i + 3));
  return out;
}

function similarity(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

export function fuzzySearch(term, branchIds, limit) {
  const wanted = trigrams(term);
  if (wanted.size < 3) return { rows: [], matchCount: 0, tookMs: 0, plan: [], warnings: [] };

  const started = performance.now();
  const params = [];
  const scope = scopeClause(branchIds, params);
  // id and name only: scoring 39k full rows would move far more data than it needs to.
  const candidates = db
    .query(`select c.id, c.name from customer c where 1 = 1${scope}`)
    .all(...params);

  const scored = [];
  for (const row of candidates) {
    const score = similarity(wanted, trigrams(row.name));
    if (score >= FUZZY_MIN_SCORE) scored.push({ id: row.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(limit, FUZZY_MAX_SUGGESTIONS));
  if (!top.length) {
    return { rows: [], matchCount: 0, tookMs: Number((performance.now() - started).toFixed(2)), plan: [], warnings: [] };
  }

  const byId = new Map(top.map((t) => [t.id, t.score]));
  const rows = db
    .query(`${SELECT_CUSTOMER} where c.id in (${top.map(() => "?").join(",")})`)
    .all(...top.map((t) => t.id))
    .map((r) => ({ ...r, similarity: Number(byId.get(r.id).toFixed(3)) }))
    .sort((a, b) => b.similarity - a.similarity);

  return {
    rows,
    matchCount: scored.length,
    tookMs: Number((performance.now() - started).toFixed(2)),
    plan: [],
    warnings: [],
    query: "customers.fuzzy",
  };
}

// --- entry point -------------------------------------------------------------

export function searchCustomers({ term = "", workingBranchId, scope = "branch", limit = 25 } = {}) {
  const shape = accountCodeShape();
  const routed = routeFor(term, shape);
  const branchIds = widenBranchIds(workingBranchId, scope);

  const empty = (route) => ({
    route,
    rows: [],
    total: 0,
    matchCount: 0,
    tookMs: 0,
    plan: [],
    warnings: [],
    query: `customers.${route}`,
  });

  if (routed.route === "none" || routed.route === "too_short") return empty(routed.route);

  if (routed.route === "quick_code") {
    const result = quickCodeSearch(workingBranchId, routed.quickCode);
    return {
      ...result,
      route: "quick_code",
      matchCount: result.rows.length,
      rows: result.rows.map((r) => ({ ...r, matched_on: "quick_code" })),
    };
  }

  if (routed.route === "account_code") {
    const result = accountCodeSearch(term.trim(), branchIds, limit);
    return {
      ...result,
      route: "account_code",
      rows: result.rows.map((r) => ({ ...r, matched_on: "account_code" })),
    };
  }

  // Name always runs; postcode runs as well when the term looks like one, and its hits lead.
  const byId = new Map();
  let tookMs = 0;
  let matchCount = 0;
  const plan = [];

  if (routed.route === "postcode_then_name") {
    const pc = postcodeSearch(term, branchIds, limit);
    tookMs += pc.tookMs;
    matchCount += pc.matchCount;
    plan.push(...pc.plan);
    for (const row of pc.rows) byId.set(row.id, { ...row, matched_on: "postcode" });
  }

  // Name needs four characters even when postcode ran on three, and trigram will not match
  // below three at all.
  if (byId.size < limit && term.trim().length >= 4) {
    const nm = nameSearch(term, branchIds, limit);
    tookMs += nm.tookMs;
    matchCount += nm.matchCount;
    plan.push(...nm.plan);
    for (const row of nm.rows) {
      if (!byId.has(row.id)) byId.set(row.id, { ...row, matched_on: "name" });
    }
  }

  // Address runs only when the cheaper routes have not filled the page. It is a full scan,
  // and for a common name like "builders" it would cost 3.4 ms to add nothing.
  if (byId.size < limit && term.trim().length >= 4) {
    const ad = addressSearch(term, branchIds, limit - byId.size);
    tookMs += ad.tookMs;
    matchCount += ad.matchCount;
    plan.push(...(ad.plan ?? []));
    for (const row of ad.rows) {
      if (!byId.has(row.id)) byId.set(row.id, { ...row, matched_on: "address" });
    }
  }

  // Nothing matched any route: the term is probably misspelled rather than absent.
  let suggested = false;
  if (!byId.size && term.trim().length >= 4) {
    const fz = fuzzySearch(term, branchIds, limit);
    tookMs += fz.tookMs;
    matchCount = fz.matchCount;
    for (const row of fz.rows) byId.set(row.id, { ...row, matched_on: "similar" });
    suggested = byId.size > 0;
  }

  const rows = [...byId.values()].slice(0, limit);
  return {
    suggested,
    route: routed.route,
    rows,
    total: rows.length,
    // Postcode and name are counted separately, so a customer matching both is counted
    // twice. Only an upper bound, and only for the mixed route — flagged rather than hidden.
    matchCount,
    matchCountApproximate: byId.size > 0,
    tookMs: Number(tookMs.toFixed(2)),
    plan,
    warnings: [],
    query: `customers.${routed.route}`,
  };
}

// The keypad for a branch, so the counter can see what 1–9 reach without guessing.
export function listQuickCodes(branchId) {
  return measured(
    "customers.quickCodes",
    `select q.quick_code, q.label, c.id as customer_id, c.name, c.account_code,
            c.is_counter_account
       from branch_quick_code q
       join customer c on c.id = q.customer_id
      where q.branch_id = ?1
      order by q.quick_code`,
    [branchId],
  );
}
