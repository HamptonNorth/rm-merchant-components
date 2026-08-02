// server/routes/permissions.js — GET /api/app-users/:id/permissions
//
// Mounted onto the same /app-users prefix as routes/branches.js. Separate file because the
// permission model is its own thing and will grow (effective-permission checks, the
// approval chain), not because the URL space is separate.

import { Hono } from "hono";
import { getUserPermissions } from "../queries/permissions.js";
import { isDev } from "../db.js";

function envelope(result, extra = {}) {
  const { query, rows, total, tookMs, plan, warnings } = result;
  const base = isDev
    ? { query, rows, total, tookMs, plan, warnings }
    : { rows, total, tookMs };
  return { ...base, ...extra };
}

export const userPermissions = new Hono();

// One call for the whole card: who they are, every branch they cover, every grant, and the
// permission catalogue they are a subset of.
userPermissions.get("/:id/permissions", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  const result = getUserPermissions(id);
  if (!result.user) return c.json({ error: `no app_user ${id}` }, 404);

  return c.json(
    envelope(result, {
      user: result.user,
      coverage: result.coverage,
      grants: result.grants,
      catalogue: result.catalogue,
    }),
  );
});
