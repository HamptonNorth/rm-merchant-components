// server/queries/branches.js — branch reads. 28 branches across 8 regions, so there is
// no paging here and none is needed.

import { measured, measuredOne } from "../db.js";

const SELECT_BRANCH = `
  select b.id, b.code, b.name,
         b.address_1, b.address_2, b.address_3, b.postcode,
         b.telephone, b.email,
         b.region_id, r.code as region_code, r.name as region_name
    from branch b
    left join region r on r.id = b.region_id`;

// `codes` narrows the list to specific branch codes. Note this is a *display* filter:
// it arrives from the browser, so it is not an authorisation boundary. When the
// role × user × branch matrix lands (docs/plan.md §7.7), permitted branches must be
// resolved server-side from the session user — see listBranchesForUser below, which is
// the seam that change goes through.
export function listBranches({ regionId, codes } = {}) {
  const where = [];
  const params = [];

  if (regionId) {
    params.push(regionId);
    where.push(`b.region_id = ?${params.length}`);
  }
  if (codes?.length) {
    const placeholders = codes.map((_, i) => `?${params.length + i + 1}`).join(", ");
    params.push(...codes);
    where.push(`b.code in (${placeholders})`);
  }

  const name =
    "branches.list" + (regionId ? "+region" : "") + (codes?.length ? "+codes" : "");
  const sql =
    `${SELECT_BRANCH}${where.length ? ` where ${where.join(" and ")}` : ""}` +
    ` order by r.name, b.code`;

  return measured(name, sql, params);
}

// The employee's operating context (docs/plan.md §9, working-branch).
//
// `default_branch_id` is where the user physically works — John Smith signs in at the
// counter and is set to Liverpool. It is NOT the customer's home branch, which is an
// ownership relation on a different table entirely.
export function getAppUser(userId) {
  return measuredOne(
    "appUsers.get",
    `select u.id, u.given_name, u.surname, u.username, u.default_branch_id,
            r.role, b.code as default_branch_code, b.name as default_branch_name
       from app_user u
       left join app_role r on r.id = u.default_role_id
       left join branch b on b.id = u.default_branch_id
      where u.id = ?1`,
    [userId],
  );
}

// Branches this user may operate from, plus their default.
//
// TODAY every user gets the whole network (optionally narrowed by `codes`), because the
// dataset has no user→branch access table: all 175 app_user rows carry exactly one
// default_branch_id and nothing else. A sales desk rep covering Liverpool and Manchester
// cannot be expressed yet. When the matrix lands this function joins to it and `codes`
// stops being load-bearing — the component above does not change.
export function listBranchesForUser(userId, { codes } = {}) {
  const user = getAppUser(userId);
  const branches = listBranches({ codes });
  return {
    user: user.row,
    defaultBranchId: user.row?.default_branch_id ?? null,
    permittedFrom: codes?.length ? "codes" : "all-branches",
    ...branches,
    query: "branches.forUser",
    tookMs: Number((user.tookMs + branches.tookMs).toFixed(2)),
  };
}

export function listAppUsers({ limit = 25 } = {}) {
  return measured(
    "appUsers.list",
    `select u.id, u.given_name, u.surname, u.username, u.default_branch_id,
            r.role, b.code as default_branch_code, b.name as default_branch_name
       from app_user u
       left join app_role r on r.id = u.default_role_id
       left join branch b on b.id = u.default_branch_id
      order by u.surname, u.given_name
      limit ?1`,
    [limit],
  );
}

export function listRegions() {
  return measured(
    "branches.regions",
    `select r.id, r.code, r.name, count(b.id) as branch_count
       from region r
       left join branch b on b.region_id = r.id
      group by r.id, r.code, r.name
      order by r.name`,
  );
}

// Registered with `bun run explain` so query cost can be checked without a round trip
// through datagenerator2 (docs/plan.md §7.4).
export const benchmarks = [
  { name: "branches.list", sql: `${SELECT_BRANCH} order by r.name, b.code`, params: [] },
];
