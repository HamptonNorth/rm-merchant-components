// server/routes/branches.js — GET /api/branches, GET /api/branches/regions

import { Hono } from "hono";
import {
  listBranches,
  listRegions,
  listBranchesForUser,
  listAppUsers,
} from "../queries/branches.js";
import { isDev } from "../db.js";

// Strip dev-only metadata in production so the API surface stays honest.
function envelope(result, extra = {}) {
  const { query, rows, total, tookMs, plan, warnings } = result;
  const base = isDev
    ? { query, rows, total, tookMs, plan, warnings }
    : { rows, total, tookMs };
  return { ...base, ...extra };
}

// Comma-separated branch codes: ?codes=01,02,31. Capped so a malformed caller cannot
// build an unbounded IN clause.
function parseCodes(raw) {
  if (!raw) return null;
  const codes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
  return codes.length ? codes : null;
}

export const branches = new Hono();

branches.get("/regions", (c) => c.json(envelope(listRegions())));

branches.get("/", (c) => {
  const raw = c.req.query("region");
  const regionId = raw ? Number(raw) : null;
  if (raw && !Number.isInteger(regionId)) {
    return c.json({ error: "region must be an integer region id" }, 400);
  }
  return c.json(envelope(listBranches({ regionId, codes: parseCodes(c.req.query("codes")) })));
});

export const appUsers = new Hono();

appUsers.get("/", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 25) || 25, 200);
  return c.json(envelope(listAppUsers({ limit })));
});

// The working-branch component's single call: who the user is, where they default to,
// and which branches they may operate from.
appUsers.get("/:id/branches", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  const result = listBranchesForUser(id, { codes: parseCodes(c.req.query("codes")) });
  if (!result.user) return c.json({ error: `no app_user ${id}` }, 404);

  return c.json(
    envelope(result, {
      user: result.user,
      defaultBranchId: result.defaultBranchId,
      permittedFrom: result.permittedFrom,
    }),
  );
});
