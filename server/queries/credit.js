// server/queries/credit.js — can this customer have the goods?
//
// Two tiers, deliberately separate calls (docs/plan.md §9): a summary that answers the
// question, and a drill-down list that shows the working. The summary has to paint
// immediately — a counter hand waiting on a 100-row invoice list to find out whether an
// account is on stop is waiting for the wrong thing.
//
// Both are served by the one index this project measured into datagenerator2:
// aged_debt(customer_id, transaction_date), which took the aggregate from 37.83 ms to
// 0.01 ms and removed the temp b-tree from the date-sorted lists.

import { measured, measuredOne, db } from "../db.js";

// Ageing bands in days. Ordered oldest-last so the UI reads left to right.
export const BANDS = [
  { id: "current", label: "Current", from: 0, to: 30 },
  { id: "30", label: "30 days", from: 30, to: 60 },
  { id: "60", label: "60 days", from: 60, to: 90 },
  { id: "90", label: "90+ days", from: 90, to: null },
];

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// `asOf` is a parameter rather than hardcoded to now so the harness and the tests can pin a
// date. A generated dataset ages: without it, every fixture drifts into 90+ eventually and
// the buckets stop demonstrating anything.
function ageExpression(asOf) {
  return `(julianday('${asOf}') - julianday(ad.transaction_date))`;
}

function bandClause(bandId, asOf) {
  const band = BANDS.find((b) => b.id === bandId);
  if (!band) return "";
  const age = ageExpression(asOf);
  return band.to === null
    ? ` and ${age} >= ${band.from}`
    : ` and ${age} >= ${band.from} and ${age} < ${band.to}`;
}

const SELECT_CUSTOMER = `
  select c.id, c.account_code, c.name, c.town, c.postcode,
         c.account_type, c.credit_status, c.credit_limit_pence,
         c.is_national_account, c.is_counter_account, c.po_required,
         c.home_branch_id, b.code as branch_code, b.name as branch_name
    from customer c
    left join branch b on b.id = c.home_branch_id
   where c.id = ?1`;

// Everything the verdict needs, in one pass over the customer's invoices.
function ageingTotals(customerId, asOf) {
  const age = ageExpression(asOf);
  const sums = BANDS.map(
    (b) =>
      `sum(case when ${age} >= ${b.from}` +
      (b.to === null ? "" : ` and ${age} < ${b.to}`) +
      ` then ad.unpaid_pence else 0 end) as band_${b.id}`,
  ).join(",\n         ");

  return measuredOne(
    "credit.ageing",
    `select coalesce(sum(ad.unpaid_pence), 0) as outstanding_pence,
            count(*) as unpaid_count,
            min(ad.transaction_date) as oldest_date,
            ${sums}
       from aged_debt ad
      where ad.customer_id = ?1 and ad.unpaid_pence > 0`,
    [customerId],
  );
}

// The verdict a counter hand actually needs, rather than a set of numbers to interpret.
//
// `near_limit` exists because "you have £180 left of £5,000" is the case where someone
// should pause before loading a van, and it is invisible if you only flag going over.
const NEAR_LIMIT_FRACTION = 0.9;

export function verdictFor({ accountType, creditStatus, limitPence, outstandingPence }) {
  if (creditStatus === "on_stop") return "on_stop";
  if (accountType === "cash") return "cash";
  if (!limitPence) return "no_limit_set";
  if (outstandingPence > limitPence) return "over_limit";
  if (outstandingPence >= limitPence * NEAR_LIMIT_FRACTION) return "near_limit";
  return "ok";
}

export function getCreditSummary(customerId, { asOf = today() } = {}) {
  const customer = measuredOne("credit.customer", SELECT_CUSTOMER, [customerId]);
  if (!customer.row) return { customer: null };

  const totals = ageingTotals(customerId, asOf);
  const row = totals.row ?? {};
  const outstandingPence = row.outstanding_pence ?? 0;
  const limitPence = customer.row.credit_limit_pence ?? 0;

  const verdict = verdictFor({
    accountType: customer.row.account_type,
    creditStatus: customer.row.credit_status,
    limitPence,
    outstandingPence,
  });

  const oldestDays = row.oldest_date
    ? Math.floor((Date.parse(asOf) - Date.parse(row.oldest_date)) / 86400000)
    : null;

  return {
    customer: customer.row,
    asOf,
    verdict,
    limitPence,
    outstandingPence,
    // Negative when over the limit, which is exactly what should be shown.
    headroomPence: limitPence ? limitPence - outstandingPence : null,
    unpaidCount: row.unpaid_count ?? 0,
    oldestUnpaidDate: row.oldest_date ?? null,
    oldestUnpaidDays: oldestDays,
    bands: BANDS.map((b) => ({ ...b, pence: row[`band_${b.id}`] ?? 0 })),
    query: "credit.summary",
    tookMs: Number((customer.tookMs + totals.tookMs).toFixed(2)),
    plan: [...customer.plan, ...totals.plan],
    warnings: [...customer.warnings, ...totals.warnings],
  };
}

const SORTS = {
  date_desc: "ad.transaction_date desc, ad.invoice_number desc",
  date_asc: "ad.transaction_date asc, ad.invoice_number asc",
  value_desc: "(ad.goods_pence + ad.tax_pence) desc",
  value_asc: "(ad.goods_pence + ad.tax_pence) asc",
};

export const SORT_KEYS = Object.keys(SORTS);

export function listInvoices(
  customerId,
  { view = "unpaid", band = null, sort = "date_desc", limit = 25, offset = 0, asOf = today() } = {},
) {
  const where =
    `ad.customer_id = ?1` +
    (view === "unpaid" ? " and ad.unpaid_pence > 0" : "") +
    bandClause(band, asOf);

  const total = db
    .query(`select count(*) as c from aged_debt ad where ${where}`)
    .get(customerId).c;

  const result = measured(
    `credit.invoices.${view}`,
    `select ad.id, ad.invoice_number, ad.transaction_date, ad.purchase_order,
            ad.goods_pence, ad.tax_pence,
            (ad.goods_pence + ad.tax_pence) as gross_pence,
            ad.unpaid_pence,
            cast(${ageExpression(asOf)} as integer) as age_days,
            ad.issuing_branch_id, b.code as issuing_branch_code, b.name as issuing_branch_name
       from aged_debt ad
       left join branch b on b.id = ad.issuing_branch_id
      where ${where}
      order by ${SORTS[sort] ?? SORTS.date_desc}
      limit ?2 offset ?3`,
    [customerId, limit, offset],
  );

  return { ...result, matchCount: total, view, band, sort, offset, asOf };
}
