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

  return t.length < 4 ? { route: "too_short" } : { route: "name" };
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

function accountCodeSearch(term, branchIds, limit) {
  const params = [`${term}%`];
  const scope = scopeClause(branchIds, params);
  params.push(limit);
  return measured(
    "customers.accountCode",
    `${SELECT_CUSTOMER} where c.account_code like ?1${scope}
      order by c.account_code limit ?${params.length}`,
    params,
  );
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
  params.push(limit);
  return measured(
    "customers.postcode",
    `${SELECT_CUSTOMER} where (${like})${scope} order by c.postcode limit ?${params.length}`,
    params,
  );
}

// Name goes through FTS. Trigram matches substrings, so each token finds a partial word.
//
// Every whitespace-separated token is required, independently and in any order: "gate build"
// finds "Gates Building Services", and so does "build gate". Sending the whole term as one
// phrase — which this did at first — looks for the literal string "gate build", which is not
// in that name, so the customer appeared not to exist.
//
// Scoped to `name:` because the FTS table also indexes town, and without the column filter
// "gate" matches Gateshead — every builder in Gateshead came back for a search that was
// plainly about a company name.
function nameQuery(term) {
  const tokens = term.trim().split(/\s+/).filter(Boolean);
  return {
    // Trigram cannot match below three characters, so shorter tokens go to LIKE instead of
    // being dropped — "j smith" should still mean the name contains a j.
    long: tokens.filter((t) => t.length >= 3),
    short: tokens.filter((t) => t.length < 3),
  };
}

function nameSearch(term, branchIds, limit) {
  const { long, short } = nameQuery(term);
  if (!long.length && !short.length) return measured("customers.name", `${SELECT_CUSTOMER} where 0`, []);

  const params = [];
  const where = [];
  let join = "";

  if (long.length) {
    params.push(long.map((t) => `name:"${t.replace(/"/g, '""')}"`).join(" "));
    join = " join customer_fts f on f.rowid = c.id";
    where.push(`customer_fts match ?${params.length}`);
  }
  for (const token of short) {
    params.push(`%${token}%`);
    where.push(`c.name like ?${params.length}`);
  }

  const scope = scopeClause(branchIds, params);
  // Names containing the term as typed lead: searching "gates building" should put the
  // literal match above one that merely holds both tokens somewhere.
  params.push(term.trim());
  const fullTerm = params.length;
  params.push(limit);

  return measured(
    "customers.name",
    `${SELECT_CUSTOMER}${join}
      where ${where.join(" and ")}${scope}
      order by (instr(lower(c.name), lower(?${fullTerm})) > 0) desc, c.name
      limit ?${params.length}`,
    params,
  );
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
    tookMs: 0,
    plan: [],
    warnings: [],
    query: `customers.${route}`,
  });

  if (routed.route === "none" || routed.route === "too_short") return empty(routed.route);

  if (routed.route === "quick_code") {
    const result = quickCodeSearch(workingBranchId, routed.quickCode);
    return { ...result, route: "quick_code", rows: result.rows.map((r) => ({ ...r, matched_on: "quick_code" })) };
  }

  if (routed.route === "account_code") {
    const result = accountCodeSearch(term.trim(), branchIds, limit);
    return { ...result, route: "account_code", rows: result.rows.map((r) => ({ ...r, matched_on: "account_code" })) };
  }

  // Name always runs; postcode runs as well when the term looks like one, and its hits lead.
  const byId = new Map();
  let tookMs = 0;
  const plan = [];

  if (routed.route === "postcode_then_name") {
    const pc = postcodeSearch(term, branchIds, limit);
    tookMs += pc.tookMs;
    plan.push(...pc.plan);
    for (const row of pc.rows) byId.set(row.id, { ...row, matched_on: "postcode" });
  }

  // Name needs four characters even when postcode ran on three, and trigram will not match
  // below three at all.
  if (byId.size < limit && term.trim().length >= 4) {
    const nm = nameSearch(term, branchIds, limit);
    tookMs += nm.tookMs;
    plan.push(...nm.plan);
    for (const row of nm.rows) {
      if (!byId.has(row.id)) byId.set(row.id, { ...row, matched_on: "name" });
    }
  }

  const rows = [...byId.values()].slice(0, limit);
  return {
    route: routed.route,
    rows,
    total: rows.length,
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
