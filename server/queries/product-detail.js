// server/queries/product-detail.js — everything about one product, from one branch.
//
// The card behind find-product. It answers the follow-up questions a counter hand asks once
// they have found the line: what does it cost, in what unit, how many come on a pallet, who
// supplies it, and — the one a catalogue card usually forgets — can I actually sell it from
// here. Availability is carried through from the ranging model rather than dropped, because a
// detail card that omits it repeats exactly the mistake find-product exists to avoid.
//
// The pricing model needs care. `product_price.tier` is NOT a quantity break for almost the
// whole catalogue: 3,697 of 3,714 products sit on a price-break scheme whose tiers are
// degenerate (`qty_from = qty_to = 1`), and their four prices simply descend — 2250, 2025,
// 1913, 1845 — which is a customer price band, not a volume discount. Only 17 products, on
// "Cement and bagged binders", carry genuine quantity ranges. Rendering the tier as a
// quantity break would print "qty 1-1" against 99.5% of the catalogue and be confidently
// wrong, so quantity ranges are only attached where the scheme actually defines them.

import { measured, measuredOne, db } from "../db.js";
import { availabilityOf } from "./product-search.js";

const SELECT_PRODUCT = `
  select p.id, p.code, p.name, p.status, p.uom_type, p.source,
         p.thickness_mm, p.width_mm, p.length_mm, p.weight,
         p.qty_per_inner, p.qty_per_outer, p.qty_per_pallet, p.pack_coverage_m2,
         p.barcode_inner, p.barcode_outer, p.barcode_pallet,
         p.last_cost_pence, p.weighted_average_cost_pence, p.low_margin, p.high_margin,
         p.specification, p.tally_id, p.allow_description_change, p.allow_direct_ex_works,
         p.created_at, p.updated_at,
         g.id as group_id, g.path as group_path, g.description as group_description,
         s.id as supplier_id, s.code as supplier_code, s.name as supplier_name,
         s.town as supplier_town, s.country as supplier_country,
         tr.code as tax_code, tr.rate as tax_rate,
         wu.per as weight_per, cu.per as cost_per,
         t.tally as tally_lengths, t.description as tally_description,
         pbk.id as price_break_id, pbk.name as price_break_name,
         pb.status as branch_status,
         (select count(*) from product_branch x where x.product_id = p.id) as ranged_branches
    from product p
    join product_group g on g.id = p.product_group_id
    left join supplier s on s.id = p.default_supplier_id
    left join tax_rate tr on tr.id = p.tax_id
    left join unit_of_measure wu on wu.id = p.weight_uom_id
    left join unit_of_measure cu on cu.id = p.cost_uom_id
    left join tally t on t.id = p.tally_id
    left join price_break pbk on pbk.id = p.price_break_id
    left join product_branch pb on pb.product_id = p.id and pb.branch_id = ?2
   where p.id = ?1`;

const SELECT_PRICES = `
  select pp.tier, pp.price_pence,
         u.id as uom_id, u.uom_type, u.input_as, u.per, u.divisor, u.input_dp,
         u.description as uom_description
    from product_price pp
    join unit_of_measure u on u.id = pp.unit_of_measure_id
   where pp.product_id = ?1
   order by u.id, pp.tier`;

// The scheme's own tiers. Joined by `seq` to the price tier, but only used when the ranges
// are real — see the header note.
const SELECT_BREAKS = `
  select seq, qty_from, qty_to, price_band, discount_pct
    from price_break_tier
   where price_break_id = ?1
   order by seq`;

// A scheme defines genuine volume pricing only if some tier covers a range wider than one
// unit and narrower than "everything". 99999999 is the open-ended catch-all.
export function hasRealQuantityBreaks(breaks = []) {
  return breaks.some((b) => b.qty_to > 1 && b.qty_to < 99999999);
}

// Where the network holds it, when this branch does not. The counter's next question after
// "not here" is "who has it", and answering it needs one more query rather than a click.
const SELECT_OTHER_BRANCHES = `
  select b.id, b.code, b.name, r.name as region_name, pb.status
    from product_branch pb
    join branch b on b.id = pb.branch_id
    left join region r on r.id = b.region_id
   where pb.product_id = ?1 and pb.branch_id <> ?2 and pb.status in ('core','stocked')
   order by b.code
   limit 12`;

export function getProductDetail(productId, branchId = null) {
  const product = measuredOne("productDetail.product", SELECT_PRODUCT, [productId, branchId ?? -1]);
  if (!product.row) return { product: null };
  const row = product.row;

  const prices = measured("productDetail.prices", SELECT_PRICES, [productId]);
  const breaks = row.price_break_id
    ? db.query(SELECT_BREAKS).all(row.price_break_id)
    : [];
  const realBreaks = hasRealQuantityBreaks(breaks);
  const bySeq = new Map(breaks.map((b) => [b.seq, b]));

  // Grouped by unit of measure, not flattened into a tier x uom grid. A product priced both
  // per sheet and per 10m2 has four bands in one and two in the other, so a grid would have
  // holes in it and imply prices that do not exist.
  const byUom = new Map();
  for (const p of prices.rows) {
    if (!byUom.has(p.uom_id)) {
      byUom.set(p.uom_id, {
        uomId: p.uom_id,
        uomType: p.uom_type,
        inputAs: p.input_as,
        per: p.per,
        divisor: p.divisor,
        inputDp: p.input_dp,
        description: p.uom_description,
        bands: [],
      });
    }
    const brk = bySeq.get(p.tier);
    byUom.get(p.uom_id).bands.push({
      tier: p.tier,
      pricePence: p.price_pence,
      // Only present when the scheme actually defines a range. Absent means "this is a
      // customer price band", which is the overwhelmingly common case.
      qtyFrom: realBreaks && brk ? brk.qty_from : null,
      qtyTo: realBreaks && brk && brk.qty_to < 99999999 ? brk.qty_to : null,
      discountPct: realBreaks && brk ? brk.discount_pct : null,
    });
  }
  const uoms = [...byUom.values()];

  const availability = availabilityOf(row);
  // Only worth asking when this branch cannot supply it from its own range.
  const elsewhere =
    availability === "elsewhere" || availability === "special_order" || availability === "to_order"
      ? measured("productDetail.otherBranches", SELECT_OTHER_BRANCHES, [productId, branchId ?? -1])
      : { rows: [], tookMs: 0, plan: [], warnings: [] };

  const tallyLengths = row.tally_lengths
    ? row.tally_lengths.split(",").map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n > 0)
    : [];

  return {
    product: { ...row, tally_lengths: tallyLengths },
    uoms,
    availability,
    priceBreaks: realBreaks ? breaks : [],
    // Stated rather than inferred by the component: "no quantity breaks" and "quantity breaks
    // we are choosing not to show" must not look the same.
    hasQuantityBreaks: realBreaks,
    otherBranches: elsewhere.rows,
    query: "productDetail",
    tookMs: Number((product.tookMs + prices.tookMs + elsewhere.tookMs).toFixed(2)),
    plan: [...product.plan, ...prices.plan, ...(elsewhere.plan ?? [])],
    warnings: [...product.warnings, ...prices.warnings, ...(elsewhere.warnings ?? [])],
  };
}
