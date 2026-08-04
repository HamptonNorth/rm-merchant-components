// src/components/shared/quantity.js — the arithmetic behind <merchant-qty-input>.
//
// Kept out of the component so it can be tested without a DOM, and because this is the part
// that must not be wrong: the difference between selling a cubic metre of oak and a
// thousandth of one is a misplaced division by 1000.
//
// Dimensions are held in millimetres on `product` and lengths are entered in metres, because
// that is how each is spoken at a counter — "25 mil oak, four two long". Every conversion to
// metres happens here, once.

export function toMetres(mm) {
  return (Number(mm) || 0) / 1000;
}

// Total pieces across a tally, whatever their size.
export function totalPieces(lines = []) {
  return lines.reduce((n, l) => n + (Number(l.pieces) || 0), 0);
}

// Running metres: what a per-metre product is priced on.
export function totalLinearM(lines = []) {
  return lines.reduce((n, l) => n + (Number(l.pieces) || 0) * (Number(l.length) || 0), 0);
}

// Cubic metres. Width comes from the line for hardwood, where every board differs, and falls
// back to the product's nominal width for a fixed tally, where it does not.
export function totalVolumeM3(lines = [], { widthMm = 0, thicknessMm = 0 } = {}) {
  const thickness = toMetres(thicknessMm);
  return lines.reduce((n, l) => {
    const width = toMetres(l.widthMm || widthMm);
    return n + (Number(l.pieces) || 0) * (Number(l.length) || 0) * width * thickness;
  }, 0);
}

// The single number the unit price is multiplied by.
//
// `per` is the unit the price is quoted in and decides which total is used: the same tally
// prices on its length if the product sells by the metre and on its volume if it sells by
// the cubic metre. `divisor` covers "£1.50 per 100".
export function pricedQuantity({
  mode,
  per = "each",
  simpleQty = 0,
  lines = [],
  product = {},
  packSize = 1,
  divisor = 1,
  packs = 1,
} = {}) {
  const div = divisor || 1;
  // A pack of a repeated make-up: 4 packs of the same 80-piece tally. Multiplies the tally
  // rather than being a mode of its own, because the make-up is what is being counted.
  const multiplier = Math.max(Number(packs) || 1, 1);

  if (mode === "tally_fixed" || mode === "tally_variable") {
    if (per === "mtr") return totalLinearM(lines) * multiplier;
    if (per === "100 mtr") return (totalLinearM(lines) * multiplier) / 100;
    if (per === "m3") {
      return (
        totalVolumeM3(lines, { widthMm: product.width_mm, thicknessMm: product.thickness_mm }) *
        multiplier
      );
    }
    if (per === "cu ft") {
      return (
        totalVolumeM3(lines, { widthMm: product.width_mm, thicknessMm: product.thickness_mm }) *
        multiplier *
        35.3147
      );
    }
    return totalPieces(lines) * multiplier;
  }

  if (mode === "sheet") {
    const area = toMetres(product.width_mm) * toMetres(product.length_mm);
    if (per === "10m2") return (simpleQty * area) / 10;
    if (per === "m2") return simpleQty * area;
    return simpleQty;
  }

  if (mode === "pack") return (simpleQty * (packSize || 1)) / div;

  return simpleQty / div;
}

export function lineTotalPence(quantity, unitPricePence) {
  return Math.round((Number(quantity) || 0) * (Number(unitPricePence) || 0));
}
