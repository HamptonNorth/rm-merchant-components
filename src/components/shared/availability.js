// src/components/shared/availability.js — how a product's five ranging states are presented.
//
// Shared by find-product and product-detail. The two show the same product moments apart, so
// a badge reading "In range" in the list and something else on the card would be a bug nobody
// would think to test for. The server derives the state (product-search.js `availabilityOf`);
// this is only how it is worded and coloured.
//
// Colour carries the meaning: green is "yes, now", blue "yes, ordered in", amber "yes, but not
// from this yard", grey "yes, from the supplier", red "no".

import { BADGE } from "./badges.js";

export const AVAILABILITY = {
  held: {
    label: "In range",
    hint: "Carried at this branch",
    detail: "Carried at this branch and sellable now.",
    classes: BADGE.good,
  },
  to_order: {
    label: "To order",
    hint: "Sold here, obtained per order",
    detail: "Sold from this branch but never held — obtained per order.",
    classes: BADGE.info,
  },
  elsewhere: {
    label: "Other branches",
    hint: "Not ranged here, carried elsewhere in the network",
    detail: "Not ranged at this branch, but carried elsewhere in the network.",
    classes: BADGE.caution,
  },
  special_order: {
    label: "Special order",
    hint: "Ranged nowhere — orderable from the supplier",
    detail: "Ranged at no branch — orderable from the supplier as a special.",
    classes: BADGE.neutral,
  },
  blocked: {
    label: "Not permitted",
    hint: "This branch may not sell this line",
    detail: "This branch may not sell this line.",
    classes: BADGE.stop,
  },
};

export function availabilityMeta(state) {
  return AVAILABILITY[state] ?? AVAILABILITY.special_order;
}

// "10m2" is how the unit_of_measure table spells it; nobody writes it that way on a quote.
const PER_LABEL = {
  "10m2": "per 10m²",
  m2: "per m²",
  m3: "per m³",
  "cu ft": "per cu ft",
  mtr: "per metre",
  "100 mtr": "per 100m",
  each: "each",
  pair: "per pair",
  litre: "per litre",
  kg: "per kg",
  dozen: "per dozen",
  pallet: "per pallet",
  pack: "per pack",
};

export function perLabel(per) {
  if (!per) return "";
  return PER_LABEL[per] ?? `per ${per}`;
}
