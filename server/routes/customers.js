// server/routes/customers.js — GET /api/customers, plus the branch keypad.

import { Hono } from "hono";
import { searchCustomers, listQuickCodes, accountCodeShape } from "../queries/customers.js";
import { isDev } from "../db.js";

const SCOPES = new Set(["branch", "neighbours", "all"]);

function envelope(result, extra = {}) {
  const { query, rows, total, tookMs, plan, warnings } = result;
  const base = isDev ? { query, rows, total, tookMs, plan, warnings } : { rows, total, tookMs };
  return { ...base, ...extra };
}

export const customers = new Hono();

customers.get("/quick-codes", (c) => {
  const branchId = Number(c.req.query("branch"));
  if (!Number.isInteger(branchId)) return c.json({ error: "branch must be an integer id" }, 400);
  return c.json(envelope(listQuickCodes(branchId)));
});

// Reported so the harness can show which shape the routing inferred — the one piece of
// behaviour that changes with the dataset rather than with the code.
customers.get("/search-shape", (c) => c.json(accountCodeShape()));

customers.get("/", (c) => {
  const term = c.req.query("q") ?? "";
  const scope = c.req.query("scope") ?? "branch";
  const rawBranch = c.req.query("branch");
  const workingBranchId = rawBranch ? Number(rawBranch) : null;
  const limit = Math.min(Number(c.req.query("limit") ?? 25) || 25, 100);

  if (!SCOPES.has(scope)) {
    return c.json({ error: `scope must be one of ${[...SCOPES].join(", ")}` }, 400);
  }
  // Only "all" can run without a working branch; the other two have nothing to scope to.
  if (scope !== "all" && !Number.isInteger(workingBranchId)) {
    return c.json({ error: "branch is required unless scope=all" }, 400);
  }

  const result = searchCustomers({ term, workingBranchId, scope, limit });
  return c.json(envelope(result, { route: result.route, scope, term }));
});
