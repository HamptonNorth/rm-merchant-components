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

// Branches this user may operate from, resolved from the permission model.
//
// This is the seam docs/plan.md §7.7 said `allowedCodes` would stop being load-bearing at,
// now that the matrix has landed in datagenerator2. The list comes from app_user_branch —
// coverage — rather than from the whole network, so a Purchasing user covering four
// branches is offered four, not twenty-nine.
//
// `permission_count` is what lets the component tell "valid branch" from "you cannot work
// here". Coverage and grants agree in the generated data (no orphan rows either way), but
// the count is the honest test: the question is whether the user can *do* anything at that
// branch, not whether a coverage row happens to exist.
const SELECT_USER_BRANCH = `
  select b.id, b.code, b.name,
         b.address_1, b.address_2, b.address_3, b.postcode,
         b.telephone, b.email, b.branch_type,
         b.region_id,
         rg.code as region_code,
         -- Head Office has no region; without a label it lands in an "Unassigned" group.
         coalesce(rg.name, case when b.branch_type = 'head_office'
                                then 'Head office' else 'Unassigned' end) as region_name,
         ub.is_default,
         r.code as role_code, r.role as role_name,
         (select count(*) from app_user_permission up
           where up.app_user_id = ub.app_user_id
             and up.branch_id   = ub.branch_id) as permission_count
    from app_user_branch ub
    join branch b   on b.id = ub.branch_id
    join app_role r on r.id = ub.app_role_id
    left join region rg on rg.id = b.region_id`;

export function listBranchesForUser(userId, { codes } = {}) {
  const user = getAppUser(userId);
  if (!user.row) {
    return { user: null, rows: [], total: 0, tookMs: user.tookMs, plan: [], warnings: [] };
  }

  const params = [userId];
  let where = ` where ub.app_user_id = ?1`;
  if (codes?.length) {
    const placeholders = codes.map((_, i) => `?${i + 2}`).join(", ");
    params.push(...codes);
    where += ` and b.code in (${placeholders})`;
  }

  const branches = measured(
    "branches.forUser" + (codes?.length ? "+codes" : ""),
    // Region NULL (Head Office) sorts last rather than first.
    `${SELECT_USER_BRANCH}${where} order by (b.region_id is null), region_name, b.code`,
    params,
  );

  // app_user_branch.is_default is authoritative; app_user.default_branch_id is the
  // denormalised fast path, and the two are required to agree (requirements-permissions.md
  // invariant 7). Prefer coverage, falling back only when `codes` filtered the default out.
  const defaultRow = branches.rows.find((b) => b.is_default);

  return {
    user: user.row,
    defaultBranchId: defaultRow?.id ?? user.row.default_branch_id ?? null,
    permittedFrom: codes?.length ? "coverage+codes" : "coverage",
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
