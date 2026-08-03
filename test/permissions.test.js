// The collapsing behind <merchant-user-permissions-view>. Two halves: the pure shaping
// functions against hand-built rows, and the same functions against the real dataset, where
// the head office user's 430 grants across 29 branches are the case the card exists for.

import { test, expect } from "bun:test";
import {
  describeBranches,
  groupGrants,
  joinList,
  categoryLabel,
  isCollapsible,
  grantSignature,
  groupBranchesByAccess,
} from "../src/components/shared/permissions.js";
import { getUserPermissions } from "../server/queries/permissions.js";
import { db } from "../server/db.js";

const NW = [
  { branch_id: 1, branch_code: "01", branch_name: "Chester", region_id: 1, region_name: "North West" },
  { branch_id: 2, branch_code: "02", branch_name: "Warrington", region_id: 1, region_name: "North West" },
  { branch_id: 3, branch_code: "03", branch_name: "Stockport", region_id: 1, region_name: "North West" },
];

test("joinList uses en-GB style with no Oxford comma", () => {
  expect(joinList(["a"])).toBe("a");
  expect(joinList(["a", "b"])).toBe("a and b");
  expect(joinList(["a", "b", "c"])).toBe("a, b and c");
});

test("categoryLabel falls back rather than dropping an unknown category", () => {
  expect(categoryLabel("works_order")).toBe("Works orders");
  expect(categoryLabel("goods_return")).toBe("Goods return");
});

test("describeBranches: a single branch is named, not counted", () => {
  expect(describeBranches([1], NW)).toBe("Chester");
});

test("describeBranches: full coverage collapses to a count", () => {
  expect(describeBranches([1, 2, 3], NW)).toBe("All 3 branches");
});

test("describeBranches: two branches are named, not counted", () => {
  // "All 2 branches" is longer than saying which two.
  expect(describeBranches([1, 2], NW.slice(0, 2))).toBe("Chester and Warrington");
});

test("describeBranches: a partly-covered region is named, not called whole", () => {
  // Nigel Dodds covers 2 of the Midlands' 3 branches. "All 2 Midlands branches" would state
  // something false about the network, so the branches are named instead.
  const midlands = [
    { branch_id: 16, branch_code: "42", branch_name: "Birmingham", region_id: 5, region_name: "Midlands", region_branch_count: 3 },
    { branch_id: 17, branch_code: "43", branch_name: "Northampton", region_id: 5, region_name: "Midlands", region_branch_count: 3 },
    { branch_id: 18, branch_code: "51", branch_name: "North London", region_id: 6, region_name: "London", region_branch_count: 4 },
  ];
  expect(describeBranches([16, 17], midlands)).toBe("Birmingham and Northampton");
});

test("describeBranches: a region beats an exception when the phrase stays tidy", () => {
  // Both descriptions are true. The region form is how someone describes their own patch,
  // so it wins whenever it is short.
  const coverage = [...NW, { branch_id: 6, branch_code: "12", branch_name: "Sheffield", region_id: 2, region_name: "North East" }];
  expect(describeBranches([1, 2, 3], coverage)).toBe("All 3 North West branches");
});

test("describeBranches: one branch short of a region states the exception", () => {
  // A regional manager missing one branch: "All branches except Lancaster", not three names.
  const coverage = [
    ...NW,
    { branch_id: 4, branch_code: "04", branch_name: "Lancaster", region_id: 1, region_name: "North West" },
  ];
  expect(describeBranches([1, 2, 3], coverage)).toBe("All branches except Lancaster");
});

test("describeBranches: a whole region is named as a region", () => {
  const coverage = [...NW, { branch_id: 6, branch_code: "12", branch_name: "Sheffield", region_id: 2, region_name: "North East" }];
  expect(describeBranches([1, 2, 3], coverage)).toBe("All 3 North West branches");
  expect(describeBranches([1, 2, 3, 6], coverage)).toBe("All 4 branches");
});

test("describeBranches: a partial region names its branches", () => {
  const coverage = [...NW, { branch_id: 6, branch_code: "12", branch_name: "Sheffield", region_id: 2, region_name: "North East" }];
  expect(describeBranches([1, 2], coverage)).toBe("Chester and Warrington");
});

test("describeBranches: whole regions and stragglers combine", () => {
  const coverage = [
    ...NW,
    { branch_id: 6, branch_code: "12", branch_name: "Sheffield", region_id: 2, region_name: "North East" },
    { branch_id: 7, branch_code: "13", branch_name: "Leeds", region_id: 2, region_name: "North East" },
  ];
  expect(describeBranches([1, 2, 3, 6], coverage)).toBe("All 3 North West branches and Sheffield");
});

test("describeBranches: near-total coverage states the exception", () => {
  // The head office shape — 28 of 29 — must not list 28 branch names.
  const coverage = Array.from({ length: 8 }, (_, i) => ({
    branch_id: i + 1,
    branch_code: String(i + 1).padStart(2, "0"),
    branch_name: `Branch ${i + 1}`,
    region_id: 1 + (i % 2),
    region_name: i % 2 ? "North East" : "North West",
  }));
  const all = coverage.map((c) => c.branch_id);
  expect(describeBranches(all.filter((id) => id !== 4), coverage)).toBe("All branches except Branch 4");
});

test("groupGrants: one permission at two limits stays two rows", () => {
  // The travelling-rep case. Merging these would state something false.
  const grants = [
    grant(1, 7, 60000, "01", "Chester", 1, "North West"),
    grant(2, 7, 30000, "02", "Warrington", 1, "North West"),
  ];
  const [category] = groupGrants({ grants, coverage: NW.slice(0, 2) });
  expect(category.label).toBe("Credit notes");
  expect(category.permissions).toHaveLength(1);
  const variants = category.permissions[0].variants;
  expect(variants).toHaveLength(2);
  // The limit held at most branches leads; here they tie, so the larger does.
  expect(variants[0]).toMatchObject({ limit: 60000, where: "Chester" });
  expect(variants[1]).toMatchObject({ limit: 30000, where: "Warrington" });
});

test("groupGrants: a null threshold is not the same as a threshold of zero", () => {
  const grants = [
    grant(1, 7, null, "01", "Chester", 1, "North West"),
    grant(2, 7, 0, "02", "Warrington", 1, "North West"),
  ];
  const [category] = groupGrants({ grants, coverage: NW.slice(0, 2) });
  expect(category.permissions[0].variants).toHaveLength(2);
});

test("groupGrants: dense off gives one row per branch", () => {
  const grants = [
    grant(1, 7, 60000, "01", "Chester", 1, "North West"),
    grant(2, 7, 60000, "02", "Warrington", 1, "North West"),
  ];
  const dense = groupGrants({ grants, coverage: NW.slice(0, 2), dense: true });
  expect(dense[0].permissions[0].variants).toHaveLength(1);

  const full = groupGrants({ grants, coverage: NW.slice(0, 2), dense: false });
  expect(full[0].permissions[0].variants.map((v) => v.where)).toEqual([
    "01 — Chester",
    "02 — Warrington",
  ]);
  // Same structure either way — the toggle changes density, not the shape of the card.
  expect(full.map((c) => c.label)).toEqual(dense.map((c) => c.label));
});

test("groupGrants: a category with nothing held is absent, not empty", () => {
  const grants = [grant(1, 1, null, "01", "Chester", 1, "North West")];
  const categories = groupGrants({ grants, coverage: NW.slice(0, 1) });
  expect(categories.map((c) => c.code)).toEqual(["sales"]);
  expect(categories.every((c) => c.permissions.length > 0)).toBe(true);
});

// --- against the real dataset -------------------------------------------------------

function userWithMostGrants() {
  return db
    .query(
      `select app_user_id as id, count(*) as n from app_user_permission
        group by app_user_id order by n desc limit 1`,
    )
    .get();
}

test("the largest user collapses from hundreds of grants to a readable card", () => {
  const { id, n } = userWithMostGrants();
  expect(n).toBeGreaterThan(100);

  const result = getUserPermissions(id);
  expect(result.user).not.toBeNull();

  const categories = groupGrants({ grants: result.grants, coverage: result.coverage });
  const lines = categories.flatMap((c) => c.permissions.flatMap((p) => p.variants));
  // Every grant is accounted for, and the row count is a fraction of it.
  expect(lines.reduce((sum, v) => sum + v.branchIds.length, 0)).toBe(result.grants.length);
  expect(lines.length).toBeLessThan(result.grants.length / 10);
  expect(lines.every((v) => v.where.length > 0)).toBe(true);
});

test("every category rendered has at least one permission, for every user", () => {
  const ids = db.query("select distinct app_user_id as id from app_user_permission").all();
  for (const { id } of ids) {
    const result = getUserPermissions(id);
    const categories = groupGrants({ grants: result.grants, coverage: result.coverage });
    for (const c of categories) {
      expect(c.permissions.length, `empty category ${c.code} for user ${id}`).toBeGreaterThan(0);
    }
    expect(isCollapsible(result.coverage)).toBe(result.coverage.length > 1);
  }
});

test("no grant is described at a branch the user does not cover", () => {
  // describeBranches falls back to "branch <id>" when a grant escapes coverage. That string
  // appearing anywhere means the upstream invariant has broken.
  const ids = db.query("select distinct app_user_id as id from app_user_permission").all();
  for (const { id } of ids) {
    const result = getUserPermissions(id);
    const categories = groupGrants({ grants: result.grants, coverage: result.coverage });
    for (const c of categories) {
      for (const p of c.permissions) {
        for (const v of p.variants) {
          expect(v.where, `user ${id} / ${p.code}`).not.toMatch(/branch \d+/);
        }
      }
    }
  }
});

test("a threshold is only ever shown against a limited permission", () => {
  const ids = db.query("select distinct app_user_id as id from app_user_permission").all();
  for (const { id } of ids) {
    const result = getUserPermissions(id);
    for (const c of groupGrants({ grants: result.grants, coverage: result.coverage })) {
      for (const p of c.permissions) {
        if (p.isLimited) continue;
        expect(
          p.variants.every((v) => v.limit == null),
          `limit on unlimited permission ${p.code}`,
        ).toBe(true);
      }
    }
  }
});

// --- the working-branch scoping added at v0.2.0 -----------------------------------------

test("grantSignature separates permission and limit, and ignores order", () => {
  const a = [grant(1, 51, 150000, "01", "Chester", 1, "North West"), grant(1, 1, null, "01", "Chester", 1, "North West")];
  const b = [grant(2, 1, null, "02", "Warrington", 1, "North West"), grant(2, 51, 150000, "02", "Warrington", 1, "North West")];
  // Same access at two branches — order of rows must not make them look different.
  expect(grantSignature(a)).toBe(grantSignature(b));

  // Same permission, lower limit, is different access and must not collapse.
  const c = [grant(3, 1, null, "03", "Stockport", 1, "North West"), grant(3, 51, 50000, "03", "Stockport", 1, "North West")];
  expect(grantSignature(c)).not.toBe(grantSignature(a));
});

test("groupBranchesByAccess excludes the working branch and flags identical ones", () => {
  const coverage = NW.map((c, i) => ({ ...c, is_default: i === 0 ? 1 : 0 }));
  const grants = [
    grant(1, 1, null, "01", "Chester", 1, "North West"),
    grant(1, 51, 150000, "01", "Chester", 1, "North West"),
    grant(2, 1, null, "02", "Warrington", 1, "North West"),
    grant(2, 51, 150000, "02", "Warrington", 1, "North West"),
    grant(3, 1, null, "03", "Stockport", 1, "North West"),
  ];

  const groups = groupBranchesByAccess({ grants, coverage, workingBranchId: 1 });

  expect(groups.map((g) => g.branchIds)).toEqual([[2], [3]]);
  expect(groups[0].sameAsWorking).toBe(true);
  expect(groups[1].sameAsWorking).toBe(false);
  expect(groups[1].permissionCount).toBe(1);
});

test("groupBranchesByAccess collapses the head office user's 29 branches", () => {
  // The case the grouping exists for: one section per branch would render 28 near-identical
  // blocks. No user in the dataset has more than a handful of distinct permission sets.
  const biggest = db
    .query("select app_user_id as id from app_user_permission group by app_user_id order by count(*) desc limit 1")
    .get();
  const { coverage, grants } = getUserPermissions(biggest.id);
  const working = coverage.find((c) => Number(c.is_default) === 1) ?? coverage[0];

  const groups = groupBranchesByAccess({ grants, coverage, workingBranchId: working.branch_id });

  expect(coverage.length).toBeGreaterThan(20);
  expect(groups.length).toBeLessThanOrEqual(5);
  // Every other branch is accounted for exactly once.
  expect(groups.reduce((n, g) => n + g.branchIds.length, 0)).toBe(coverage.length - 1);
  expect(groups.every((g) => !g.branchIds.includes(working.branch_id))).toBe(true);
  // Ordering: identical-to-working first.
  const flagged = groups.map((g) => g.sameAsWorking);
  expect(flagged.slice().sort((a, b) => Number(b) - Number(a))).toEqual(flagged);
});

test("every multi-branch user groups into fewer sections than branches, or equal", () => {
  const users = db
    .query("select app_user_id as id from app_user_branch group by app_user_id having count(*) > 1")
    .all();
  expect(users.length).toBeGreaterThan(0);

  for (const { id } of users) {
    const { coverage, grants } = getUserPermissions(id);
    const working = coverage.find((c) => Number(c.is_default) === 1) ?? coverage[0];
    const groups = groupBranchesByAccess({ grants, coverage, workingBranchId: working.branch_id });

    expect(groups.length, `user ${id} groups`).toBeLessThanOrEqual(coverage.length - 1);
    expect(
      groups.reduce((n, g) => n + g.branchIds.length, 0),
      `user ${id} branches accounted for`,
    ).toBe(coverage.length - 1);
  }
});

function grant(branchId, permissionId, limit, code, name, regionId, regionName) {
  const meta = db
    .query("select id, code, name, description, category, scope, is_limited, sort from permission where id = ?1")
    .get(permissionId);
  return {
    branch_id: branchId,
    branch_code: code,
    branch_name: name,
    region_id: regionId,
    region_name: regionName,
    permission_id: meta.id,
    code: meta.code,
    name: meta.name,
    description: meta.description,
    category: meta.category,
    scope: meta.scope,
    is_limited: meta.is_limited,
    sort: meta.sort,
    approval_limit_pence: limit,
  };
}
