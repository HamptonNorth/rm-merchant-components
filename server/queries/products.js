// server/queries/products.js — what a quantity input needs to know about a product.
//
// Quantity entry is where merchant software separates from packaged ERP. Everything sells
// "6 bolts at £2.50"; rather less handles a pallet of 366 bricks priced per 1000, and almost
// nothing handles a timber tally — a list of lengths, each with a piece count, totalling to
// cubic metres. So the product's unit-of-measure configuration is a first-class read rather
// than a corner of the product record.

import { measured, measuredOne, db } from "../db.js";

const SELECT_PRODUCT = `
  select p.id, p.code, p.name, p.uom_type,
         p.thickness_mm, p.width_mm, p.length_mm,
         p.qty_per_inner, p.qty_per_outer, p.qty_per_pallet, p.pack_coverage_m2,
         p.tally_id, p.status,
         t.tally as tally_lengths, t.description as tally_description
    from product p
    left join tally t on t.id = p.tally_id
   where p.id = ?1`;

// Every unit the product can be priced in, with its tiers. A product priced both per sheet
// and per 10m² has two entry modes, and the counter picks.
const SELECT_PRICES = `
  select pp.tier, pp.price_pence,
         u.id as uom_id, u.uom_type, u.input_as, u.per, u.divisor, u.input_dp,
         u.description as uom_description
    from product_price pp
    join unit_of_measure u on u.id = pp.unit_of_measure_id
   where pp.product_id = ?1
   order by u.id, pp.tier`;

// Which entry mode the component should present. Derived here rather than in the component
// because it depends on how the product is priced, not on how it is displayed.
export function qtyModeFor({ product, uoms }) {
  if (product.uom_type === "tally") {
    // A tally with a defined length list is a fixed tally: pick counts against known lengths.
    // Without one it is hardwood — random width and length, measured parcel by parcel.
    return product.tally_lengths ? "tally_fixed" : "tally_variable";
  }
  if (product.uom_type === "sheet_material") return "sheet";
  // A divisor above 1 means the price is quoted per N: "£1.50 per 100", a pallet of 336.
  if (uoms.some((u) => u.divisor > 1)) return "pack";
  if ((product.qty_per_pallet ?? 1) > 1 || (product.qty_per_outer ?? 1) > 1) return "pack";
  return "unit";
}

export function getQtyConfig(productId) {
  const product = measuredOne("products.qtyConfig", SELECT_PRODUCT, [productId]);
  if (!product.row) return { product: null };

  const prices = measured("products.prices", SELECT_PRICES, [productId]);

  // Group the flat price rows into one entry per unit of measure.
  const byUom = new Map();
  for (const row of prices.rows) {
    if (!byUom.has(row.uom_id)) {
      byUom.set(row.uom_id, {
        uomId: row.uom_id,
        uomType: row.uom_type,
        inputAs: row.input_as,
        per: row.per,
        divisor: row.divisor,
        inputDp: row.input_dp,
        description: row.uom_description,
        tiers: [],
      });
    }
    byUom.get(row.uom_id).tiers.push({ tier: row.tier, pricePence: row.price_pence });
  }
  const uoms = [...byUom.values()];

  // "2.4,3,3.6" -> [2.4, 3, 3.6]. Stored as text because the list is the product's identity,
  // not a quantity to compute with.
  const tallyLengths = product.row.tally_lengths
    ? product.row.tally_lengths
        .split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];

  return {
    product: { ...product.row, tally_lengths: tallyLengths },
    uoms,
    mode: qtyModeFor({ product: product.row, uoms }),
    query: "products.qtyConfig",
    tookMs: Number((product.tookMs + prices.tookMs).toFixed(2)),
    plan: [...product.plan, ...prices.plan],
    warnings: [...product.warnings, ...prices.warnings],
  };
}

// The tally catalogue, so a fixed-tally product can be demonstrated even though no product
// currently references one — product.tally_id is 0 for all 3,714 rows.
export function listTallies() {
  return measured("products.tallies", `select id, description, tally from tally order by id`);
}

export function findProductsByMode(mode, limit = 5) {
  const clause = {
    tally_variable: `p.uom_type = 'tally'`,
    sheet: `p.uom_type = 'sheet_material'`,
    pack: `p.uom_type = 'unit' and p.qty_per_pallet > 1`,
    unit: `p.uom_type = 'unit' and p.qty_per_pallet <= 1`,
  }[mode];
  if (!clause) return { rows: [] };
  return measured(
    `products.byMode.${mode}`,
    `select p.id, p.code, p.name from product p where ${clause} order by p.id limit ?1`,
    [limit],
  );
}
