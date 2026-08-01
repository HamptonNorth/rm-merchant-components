// src/components/shared/format.js — presentation helpers shared by every component.
//
// Money crosses the wire as integer pence (datagenerator2 docs/NAMING.md rule 6) and is
// only ever converted for display, here, once.

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const GBP_WHOLE = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export function fmtPence(pence, { whole = false } = {}) {
  if (pence === null || pence === undefined) return "—";
  const pounds = pence / 100;
  return whole ? GBP_WHOLE.format(pounds) : GBP.format(pounds);
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE.format(d);
}

// The dataset stores addresses as loose lines with empty strings for absent parts.
export function addressLines(row, keys = ["address_1", "address_2", "address_3"]) {
  return keys.map((k) => row?.[k]).filter((v) => v && String(v).trim().length);
}
