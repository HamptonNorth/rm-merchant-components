// The card behind <merchant-product-detail>. The pricing model is what these guard: `tier`
// means two different things depending on the product's scheme, and getting that backwards
// would print a confident lie on 99.5% of the catalogue.

import { test, expect } from "bun:test";
import { getProductDetail, hasRealQuantityBreaks } from "../server/queries/product-detail.js";
import { db } from "../server/db.js";

const BRANCH = db
  .query(`select branch_id from product_branch group by 1 order by count(*) desc limit 1`)
  .get().branch_id;

const twoUnits = db
  .query(`select product_id as id from product_price group by product_id
           having count(distinct unit_of_measure_id) > 1 limit 1`)
  .get();

const withBreaks = db
  .query(`select p.id from product p join price_break_tier t on t.price_break_id = p.price_break_id
           where t.qty_to > 1 and t.qty_to < 99999999 group by p.id limit 1`)
  .get();

const blocked = db
  .query(`select product_id as id, branch_id from product_branch where status = 'not_permitted' limit 1`)
  .get();

test("hasRealQuantityBreaks rejects the degenerate scheme", () => {
  // The default scheme covers 3,697 products and its tiers are qty 1-1 with one open-ended
  // catch-all. Those are customer price bands, not volume pricing.
  expect(hasRealQuantityBreaks([{ qty_from: 1, qty_to: 99999999 }, { qty_from: 1, qty_to: 1 }])).toBe(false);
  expect(hasRealQuantityBreaks([{ qty_from: 1, qty_to: 5 }, { qty_from: 6, qty_to: 10 }])).toBe(true);
  expect(hasRealQuantityBreaks([])).toBe(false);
});

test("the overwhelming majority of the catalogue has NO quantity breaks", () => {
  // If this ever flips, the card's default labelling is wrong and the heading needs revisiting.
  const degenerate = db.query(`select count(*) c from product where price_break_id in
    (select price_break_id from price_break_tier group by price_break_id
      having max(case when qty_to < 99999999 then qty_to else 0 end) <= 1)`).get().c;
  const total = db.query(`select count(*) c from product`).get().c;
  expect(degenerate / total).toBeGreaterThan(0.9);
});

test("a product with no real breaks reports bands, not quantity ranges", () => {
  const d = getProductDetail(twoUnits.id, BRANCH);
  expect(d.hasQuantityBreaks).toBe(false);
  for (const uom of d.uoms) {
    for (const band of uom.bands) {
      // Printing "qty 1-1" here would be the bug this guards.
      expect(band.qtyFrom, `${band.tier} should carry no range`).toBeNull();
      expect(band.qtyTo).toBeNull();
    }
  }
});

test("a product with real breaks reports its ranges", () => {
  const d = getProductDetail(withBreaks.id, BRANCH);
  expect(d.hasQuantityBreaks).toBe(true);
  const ranged = d.uoms.flatMap((u) => u.bands).filter((b) => b.qtyFrom != null);
  expect(ranged.length).toBeGreaterThan(0);
  for (const b of ranged) {
    if (b.qtyTo != null) expect(b.qtyTo).toBeGreaterThanOrEqual(b.qtyFrom);
  }
});

test("prices group by unit of measure, never flattened into a grid", () => {
  // 266 products are priced two ways with different band counts per unit, so a tier x unit
  // grid would have holes and imply prices that do not exist.
  const d = getProductDetail(twoUnits.id, BRANCH);
  expect(d.uoms.length).toBeGreaterThan(1);
  const counts = d.uoms.map((u) => u.bands.length);
  expect(Math.min(...counts)).toBeGreaterThan(0);
  for (const uom of d.uoms) {
    expect(uom.per).toBeTruthy();
    for (const b of uom.bands) expect(typeof b.pricePence).toBe("number");
  }
});

test("availability matches what find-product would say for the same pair", () => {
  // The two components show the same product moments apart. A card disagreeing with the list
  // it was opened from is a bug nobody would think to look for.
  const d = getProductDetail(blocked.id, blocked.branch_id);
  expect(d.availability).toBe("blocked");
  const held = db.query(`select product_id as id, branch_id from product_branch
                          where status in ('core','stocked') limit 1`).get();
  expect(getProductDetail(held.id, held.branch_id).availability).toBe("held");
});

test("other branches are only fetched when this branch cannot supply it", () => {
  const held = db.query(`select product_id as id, branch_id from product_branch
                          where status in ('core','stocked') limit 1`).get();
  expect(getProductDetail(held.id, held.branch_id).otherBranches).toEqual([]);

  // And when it cannot, the answer to "who has it" comes back without a second round trip.
  const elsewhere = db.query(`select p.id, b.id as branch_id from product p, branch b
     where b.branch_type = 'trading'
       and (select count(*) from product_branch where product_id = p.id) > 2
       and not exists (select 1 from product_branch where product_id = p.id and branch_id = b.id)
     limit 1`).get();
  const d = getProductDetail(elsewhere.id, elsewhere.branch_id);
  expect(d.availability).toBe("elsewhere");
  expect(d.otherBranches.length).toBeGreaterThan(0);
  for (const b of d.otherBranches) expect(b.branch_id ?? b.id).not.toBe(elsewhere.branch_id);
});

test("a missing product is a null product, not a throw", () => {
  expect(getProductDetail(99999999, BRANCH).product).toBeNull();
});

test("tax, supplier and group come back joined", () => {
  const d = getProductDetail(twoUnits.id, BRANCH);
  expect(d.product.tax_code).toBeTruthy();
  expect(d.product.group_path).toContain("Top");
  expect(d.product.supplier_name).toBeTruthy();
});
