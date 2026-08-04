// server/routes/products.js — product reads for quantity entry.

import { Hono } from "hono";
import { getQtyConfig, listTallies } from "../queries/products.js";
import {
  searchProducts,
  listProductGroups,
  listProductSuppliers,
  rangeSummary,
} from "../queries/product-search.js";
import { isDev } from "../db.js";

const SCOPES = new Set(["branch", "all"]);

// Same ceiling and the same reporting as the customer search: a limit applied quietly is
// indistinguishable from a bug, which is how the 100-row cap was found the first time.
const MAX_LIMIT = 500;

function envelope(result, extra = {}) {
  const { query, rows, total, tookMs, plan, warnings } = result;
  const base = isDev ? { query, rows, total, tookMs, plan, warnings } : { rows, total, tookMs };
  return { ...base, ...extra };
}

export const products = new Hono();

// Facets and the range summary come before /:id so "groups" is not read as an id.
products.get("/groups", (c) => {
  const branch = c.req.query("branch");
  return c.json(envelope(listProductGroups(branch ? Number(branch) : null)));
});

products.get("/suppliers", (c) => {
  const branch = c.req.query("branch");
  return c.json(envelope(listProductSuppliers(branch ? Number(branch) : null)));
});

// What this branch ranges, so an empty branch-scoped search explains itself.
products.get("/range-summary", (c) => {
  const branchId = Number(c.req.query("branch"));
  if (!Number.isInteger(branchId)) return c.json({ error: "branch must be an integer id" }, 400);
  const r = rangeSummary(branchId);
  return c.json(envelope(r, { summary: r.rows[0] ?? null }));
});

products.get("/", (c) => {
  const term = c.req.query("q") ?? "";
  const scope = c.req.query("scope") ?? "branch";
  const rawBranch = c.req.query("branch");
  const branchId = rawBranch ? Number(rawBranch) : null;
  const requested = Number(c.req.query("limit") ?? 25) || 25;
  const limit = Math.min(requested, MAX_LIMIT);

  if (!SCOPES.has(scope)) {
    return c.json({ error: `scope must be one of ${[...SCOPES].join(", ")}` }, 400);
  }
  // A branch-scoped search has nothing to scope to without one. "all" still takes a branch
  // when it has one, because every row reports its state at that branch either way.
  if (scope === "branch" && !Number.isInteger(branchId)) {
    return c.json({ error: "branch is required unless scope=all" }, 400);
  }

  const result = searchProducts({
    term,
    branchId,
    scope,
    groupPath: c.req.query("group") ?? "",
    supplierId: c.req.query("supplier") ? Number(c.req.query("supplier")) : null,
    limit,
  });

  return c.json(
    envelope(result, {
      route: result.route,
      scope,
      term,
      matchCount: result.matchCount ?? result.total,
      limit,
      limitRequested: requested,
      limitCapped: requested > MAX_LIMIT,
      truncated: Boolean(result.truncated),
    }),
  );
});

products.get("/tallies", (c) => {
  const r = listTallies();
  return c.json(isDev ? r : { rows: r.rows, total: r.total, tookMs: r.tookMs });
});

products.get("/:id/qty-config", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  const result = getQtyConfig(id);
  if (!result.product) return c.json({ error: `no product ${id}` }, 404);

  const { query, tookMs, plan, warnings, ...rest } = result;
  return c.json(isDev ? { query, tookMs, plan, warnings, ...rest } : rest);
});
