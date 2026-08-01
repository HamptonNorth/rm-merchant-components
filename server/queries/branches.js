// server/queries/branches.js — branch reads. 28 branches across 8 regions, so there is
// no paging here and none is needed.

import { measured } from "../db.js";

const SELECT_BRANCH = `
  select b.id, b.code, b.name,
         b.address_1, b.address_2, b.address_3, b.postcode,
         b.telephone, b.email,
         b.region_id, r.code as region_code, r.name as region_name
    from branch b
    left join region r on r.id = b.region_id`;

export function listBranches({ regionId } = {}) {
  if (regionId) {
    return measured(
      "branches.listByRegion",
      `${SELECT_BRANCH} where b.region_id = ?1 order by b.code`,
      [regionId],
    );
  }
  return measured("branches.list", `${SELECT_BRANCH} order by r.name, b.code`);
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
