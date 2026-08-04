// server/routes/customers.js — GET /api/customers, plus the branch keypad.

import { Hono } from "hono";
import { searchCustomers, listQuickCodes, accountCodeShape } from "../queries/customers.js";
import { isDev } from "../db.js";

const SCOPES = new Set(["branch", "neighbours", "all"]);

// The ceiling exists so one search cannot ask for 39,000 rows. It is reported rather than
// applied quietly: `limit=500` silently becoming 100 is indistinguishable from a bug, which
// is exactly how it was first found.
const MAX_LIMIT = 500;

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
  const requested = Number(c.req.query("limit") ?? 25) || 25;
  const limit = Math.min(requested, MAX_LIMIT);

  if (!SCOPES.has(scope)) {
    return c.json({ error: `scope must be one of ${[...SCOPES].join(", ")}` }, 400);
  }
  // Only "all" can run without a working branch; the other two have nothing to scope to.
  if (scope !== "all" && !Number.isInteger(workingBranchId)) {
    return c.json({ error: "branch is required unless scope=all" }, 400);
  }

  const result = searchCustomers({ term, workingBranchId, scope, limit });
  return c.json(
    envelope(result, {
      route: result.route,
      scope,
      term,
      // How many matched, against how many came back. Without both, a truncated page looks
      // like the whole answer.
      matchCount: result.matchCount ?? result.total,
      matchCountApproximate: Boolean(result.matchCountApproximate),
      limit,
      limitRequested: requested,
      limitCapped: requested > MAX_LIMIT,
      truncated: (result.matchCount ?? result.total) > result.total,
    }),
  );
});
