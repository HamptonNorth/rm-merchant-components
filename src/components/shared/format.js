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

// Selling prices are stored and transacted ex-VAT — that is the authoritative figure, and
// what an order line carries. A VAT-inclusive figure is derived for display when a customer
// is asking "what will it cost me", which is a retail question rather than a trade one.
//
// Rounded to the nearest penny. That makes a displayed inclusive unit price indicative
// rather than exact: real VAT is computed once on the invoice total, not per line, so
// 3 x £19.13 inc-VAT will not always equal the VAT on 3 x £19.13 ex-VAT. Fine for a counter
// enquiry, which is what this is for, and the reason the ex-VAT figure stays authoritative.
export function withVat(pence, ratePct) {
  if (pence === null || pence === undefined) return pence;
  const rate = Number(ratePct) || 0;
  // Zero-rated and exempt both arrive as 0 and must not be dressed up as "includes VAT".
  if (rate <= 0) return pence;
  return Math.round(pence * (1 + rate / 100));
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
