// server/queries/permissions.js — what one member of staff may do, and where.
//
// This is the read behind <merchant-user-permissions-view>. The permission model landed in
// datagenerator2 (docs/requirements-permissions.md): a user COVERS branches, holding a role
// at each, and is GRANTED permissions per branch. A grant row existing means the permission
// is held; there are no deny rows. approval_limit_pence is a threshold — above it the action
// routes for approval, it is never refused — and NULL means no threshold at all.
//
// One user can hold a lot of grants: a head office user covers 29 branches and has ~430.
// That is why this returns flat rows and lets the component collapse them, rather than
// shaping a nested structure the component would have to flatten again to group differently.

import { measured, measuredOne } from "../db.js";

const SELECT_USER = `
  select u.id, u.given_name, u.surname, u.username, u.email,
         u.default_branch_id,
         b.code as default_branch_code, b.name as default_branch_name,
         r.id as role_id, r.code as role_code, r.role as role_name, r.approval_rank
    from app_user u
    left join branch b on b.id = u.default_branch_id
    left join app_role r on r.id = u.default_role_id
   where u.id = ?1`;

// Coverage: which branches, in what role at each. Role can differ per branch, so it is
// carried here rather than assumed from the user's default role.
const SELECT_COVERAGE = `
  select ub.branch_id, ub.is_default,
         b.code as branch_code, b.name as branch_name, b.branch_type,
         b.region_id, rg.name as region_name,
         -- How many branches the region really has, which is not the same as how many of
         -- them this user covers. Without it, someone covering 2 of the 3 Midlands branches
         -- gets described as holding "all 2 Midlands branches", which reads as though the
         -- Midlands had two.
         (select count(*) from branch b2 where b2.region_id = b.region_id) as region_branch_count,
         r.code as role_code, r.role as role_name, r.approval_rank
    from app_user_branch ub
    join branch b on b.id = ub.branch_id
    left join region rg on rg.id = b.region_id
    join app_role r on r.id = ub.app_role_id
   where ub.app_user_id = ?1
   order by b.region_id, b.code`;

// The grants themselves. Ordered by the catalogue's own `sort` so the card lists
// permissions in a stable, meaningful order rather than by id or alphabetically.
const SELECT_GRANTS = `
  select up.branch_id, b.code as branch_code, b.name as branch_name,
         b.region_id, rg.name as region_name,
         p.id as permission_id, p.code, p.name, p.description,
         p.category, p.scope, p.is_limited, p.sort,
         up.approval_limit_pence
    from app_user_permission up
    join permission p on p.id = up.permission_id
    join branch b on b.id = up.branch_id
    left join region rg on rg.id = b.region_id
   where up.app_user_id = ?1
   order by p.sort, b.region_id, b.code`;

// The full catalogue, so the component can name a category it holds nothing in — and, per
// the design decision, omit that category entirely rather than showing an empty heading.
const SELECT_CATALOGUE = `
  select id, code, name, description, category, scope, is_limited, sort
    from permission
   order by sort`;

export function getUserPermissions(userId) {
  const user = measuredOne("permissions.user", SELECT_USER, [userId]);
  if (!user.row) return { user: null };

  const coverage = measured("permissions.coverage", SELECT_COVERAGE, [userId]);
  const grants = measured("permissions.grants", SELECT_GRANTS, [userId]);
  const catalogue = measured("permissions.catalogue", SELECT_CATALOGUE, []);

  return {
    user: user.row,
    coverage: coverage.rows,
    grants: grants.rows,
    catalogue: catalogue.rows,
    // dev-only metadata, merged by the route's envelope
    query: grants.query,
    total: grants.total,
    tookMs: (user.tookMs ?? 0) + coverage.tookMs + grants.tookMs + catalogue.tookMs,
    plan: grants.plan,
    warnings: [...(coverage.warnings ?? []), ...(grants.warnings ?? [])],
    rows: grants.rows,
  };
}
