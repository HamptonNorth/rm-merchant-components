// The arithmetic behind <merchant-qty-input>. This is the part that must not be wrong: the
// difference between selling a cubic metre of oak and a thousandth of one is one misplaced
// division by 1000, and it would look plausible on screen either way.

import { test, expect } from "bun:test";
import {
  toMetres,
  totalPieces,
  totalLinearM,
  totalVolumeM3,
  pricedQuantity,
  lineTotalPence,
} from "../src/components/shared/quantity.js";

test("6 bolts at £2.50 — the case every system handles", () => {
  const qty = pricedQuantity({ mode: "unit", per: "each", simpleQty: 6 });
  expect(qty).toBe(6);
  expect(lineTotalPence(qty, 250)).toBe(1500);
});

test("a pallet of 366 bricks priced per 1,000", () => {
  // Entered as one pallet. The price is quoted per 1,000, so the divisor turns 366 units
  // into 0.366 of a priced unit — not 366 of them, which would be a 1,000-fold error.
  const qty = pricedQuantity({ mode: "pack", per: "1000", simpleQty: 1, packSize: 366, divisor: 1000 });
  expect(qty).toBeCloseTo(0.366, 6);
  expect(lineTotalPence(qty, 105000)).toBe(38430); // £1,050 per 1,000 -> £384.30
});

test("a pallet priced per unit is not divided", () => {
  const qty = pricedQuantity({ mode: "pack", per: "each", simpleQty: 1, packSize: 366, divisor: 1 });
  expect(qty).toBe(366);
});

test("a sheet prices by the sheet or by area, from the same entry", () => {
  const product = { width_mm: 1220, length_mm: 2240 }; // 2.7328 m²
  expect(pricedQuantity({ mode: "sheet", per: "each", simpleQty: 3, product })).toBe(3);
  expect(pricedQuantity({ mode: "sheet", per: "m2", simpleQty: 3, product })).toBeCloseTo(8.1984, 4);
  // Priced per 10m², so the quantity is tenths of that area.
  expect(pricedQuantity({ mode: "sheet", per: "10m2", simpleQty: 3, product })).toBeCloseTo(0.81984, 5);
});

test("a fixed tally totals to length or to volume, depending on how it is priced", () => {
  // 19 x 150mm joinery redwood: 10 at 2.4 m and 5 at 4.8 m.
  const lines = [
    { length: 2.4, pieces: 10 },
    { length: 4.8, pieces: 5 },
  ];
  const product = { width_mm: 150, thickness_mm: 19 };

  expect(totalPieces(lines)).toBe(15);
  expect(totalLinearM(lines)).toBeCloseTo(48, 6);
  expect(totalVolumeM3(lines, { widthMm: 150, thicknessMm: 19 })).toBeCloseTo(0.1368, 6);

  expect(pricedQuantity({ mode: "tally_fixed", per: "mtr", lines, product })).toBeCloseTo(48, 6);
  expect(pricedQuantity({ mode: "tally_fixed", per: "m3", lines, product })).toBeCloseTo(0.1368, 6);
  // £770.01/m³
  expect(lineTotalPence(0.1368, 77001)).toBe(10534);
});

test("hardwood takes a width per parcel, because every board is different", () => {
  // 25mm American White Oak — the dataset calls it "random width, 4in (100mm) and wider".
  const lines = [
    { pieces: 3, length: 2.5, widthMm: 210 },
    { pieces: 2, length: 3.1, widthMm: 180 },
    { pieces: 4, length: 2.1, widthMm: 260 },
  ];
  const product = { width_mm: 100, thickness_mm: 25 };

  const volume = totalVolumeM3(lines, { widthMm: product.width_mm, thicknessMm: 25 });
  expect(volume).toBeCloseTo(0.121875, 6);
  // The per-line width must win over the product's nominal, or every board is priced at
  // 100mm and the customer is undercharged for the wide ones.
  expect(volume).not.toBeCloseTo(
    totalVolumeM3(lines.map((l) => ({ ...l, widthMm: 0 })), { widthMm: 100, thicknessMm: 25 }),
    6,
  );
  expect(lineTotalPence(volume, 340000)).toBe(41438);
});

test("a tally line falls back to the product width when the line has none", () => {
  // A fixed tally is uniform stock: the width is the product's, not the board's.
  const lines = [{ pieces: 10, length: 2.4 }];
  expect(totalVolumeM3(lines, { widthMm: 150, thicknessMm: 19 })).toBeCloseTo(0.0684, 6);
});

test("millimetres become metres exactly once", () => {
  // The whole class of error this module exists to contain.
  expect(toMetres(1220)).toBe(1.22);
  expect(toMetres(25)).toBe(0.025);
  expect(toMetres(null)).toBe(0);
  // One piece, 1 m long, 1000mm wide, 1000mm thick = 1 m³.
  expect(totalVolumeM3([{ pieces: 1, length: 1, widthMm: 1000 }], { thicknessMm: 1000 })).toBe(1);
});

test("empty and partial input never produces NaN", () => {
  // A half-typed tally row must total to zero, not to NaN, or the line total renders "£NaN".
  const lines = [{ pieces: 3, length: "", widthMm: 210 }, { pieces: "", length: 2.4 }];
  expect(totalVolumeM3(lines, { widthMm: 150, thicknessMm: 19 })).toBe(0);
  expect(totalLinearM(lines)).toBe(0);
  expect(lineTotalPence(NaN, 250)).toBe(0);
  expect(pricedQuantity({ mode: "unit", simpleQty: "" })).toBe(0);
});

test("all four tally units convert from the same entry", () => {
  // The unit_of_measure table carries per mtr, per 100 mtr, per m3 and per cu ft for tally
  // products — because how a tally is priced depends on how big the order is.
  const lines = [{ pieces: 10, length: 2.4 }, { pieces: 5, length: 4.8 }];
  const product = { width_mm: 150, thickness_mm: 19 };
  const q = (per) => pricedQuantity({ mode: "tally_fixed", per, lines, product });

  expect(q("mtr")).toBeCloseTo(48, 6);
  expect(q("100 mtr")).toBeCloseTo(0.48, 6);
  expect(q("m3")).toBeCloseTo(0.1368, 6);
  expect(q("cu ft")).toBeCloseTo(0.1368 * 35.3147, 4);
});

test("packs multiply a tally of repeated make-up", () => {
  // Four packs of the same 80-piece tally, not four separate tallies typed out.
  const lines = [{ pieces: 80, length: 3.6 }];
  const product = { width_mm: 50, thickness_mm: 25 };

  const one = pricedQuantity({ mode: "tally_fixed", per: "m3", lines, product, packs: 1 });
  const four = pricedQuantity({ mode: "tally_fixed", per: "m3", lines, product, packs: 4 });
  expect(four).toBeCloseTo(one * 4, 8);

  // 80 x 3.6m of 25x50 = 0.36 m3 a pack.
  expect(one).toBeCloseTo(0.36, 6);
  expect(pricedQuantity({ mode: "tally_fixed", per: "mtr", lines, product, packs: 4 })).toBeCloseTo(1152, 6);
});

test("a random-length pack keeps its section fixed", () => {
  // 80 pieces of 25x50 at mixed lengths. Width comes from the product, not the line, so
  // nobody can type a width and silently change the price of a fixed section.
  const mixed = [
    { pieces: 30, length: 2.4 },
    { pieces: 30, length: 3.0 },
    { pieces: 20, length: 4.8 },
  ];
  expect(totalPieces(mixed)).toBe(80);
  expect(totalLinearM(mixed)).toBeCloseTo(258, 6);
  expect(totalVolumeM3(mixed, { widthMm: 50, thicknessMm: 25 })).toBeCloseTo(0.3225, 6);
});
