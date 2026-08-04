// server/routes/credit.js — GET /api/customers/:id/credit and .../invoices

import { Hono } from "hono";
import { getCreditSummary, listInvoices, SORT_KEYS, BANDS } from "../queries/credit.js";
import { isDev } from "../db.js";

const MAX_LIMIT = 200;
const VIEWS = new Set(["unpaid", "recent"]);
const BAND_IDS = new Set(BANDS.map((b) => b.id));

function envelope(result, extra = {}) {
  const { query, rows, total, tookMs, plan, warnings } = result;
  const base = isDev ? { query, rows, total, tookMs, plan, warnings } : { rows, total, tookMs };
  return { ...base, ...extra };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const credit = new Hono();

credit.get("/:id/credit", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  const asOf = c.req.query("asOf");
  if (asOf && !ISO_DATE.test(asOf)) return c.json({ error: "asOf must be YYYY-MM-DD" }, 400);

  const result = getCreditSummary(id, asOf ? { asOf } : {});
  if (!result.customer) return c.json({ error: `no customer ${id}` }, 404);

  const { query, tookMs, plan, warnings, ...summary } = result;
  return c.json(isDev ? { query, tookMs, plan, warnings, ...summary } : summary);
});

credit.get("/:id/invoices", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  const view = c.req.query("view") ?? "unpaid";
  if (!VIEWS.has(view)) return c.json({ error: `view must be one of ${[...VIEWS].join(", ")}` }, 400);

  const band = c.req.query("band") || null;
  if (band && !BAND_IDS.has(band)) {
    return c.json({ error: `band must be one of ${[...BAND_IDS].join(", ")}` }, 400);
  }

  const sort = c.req.query("sort") ?? "date_desc";
  if (!SORT_KEYS.includes(sort)) {
    return c.json({ error: `sort must be one of ${SORT_KEYS.join(", ")}` }, 400);
  }

  const asOf = c.req.query("asOf");
  if (asOf && !ISO_DATE.test(asOf)) return c.json({ error: "asOf must be YYYY-MM-DD" }, 400);

  const requested = Number(c.req.query("limit") ?? 25) || 25;
  const limit = Math.min(requested, MAX_LIMIT);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);

  const result = listInvoices(id, { view, band, sort, limit, offset, asOf: asOf || undefined });

  return c.json(
    envelope(result, {
      view,
      band,
      sort,
      limit,
      limitRequested: requested,
      limitCapped: requested > MAX_LIMIT,
      offset,
      matchCount: result.matchCount,
      truncated: result.matchCount > offset + result.total,
      asOf: result.asOf,
    }),
  );
});
