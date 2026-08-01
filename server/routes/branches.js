// server/routes/branches.js — GET /api/branches, GET /api/branches/regions

import { Hono } from "hono";
import { listBranches, listRegions } from "../queries/branches.js";
import { isDev } from "../db.js";

// Strip dev-only metadata in production so the API surface stays honest.
function envelope(result) {
  const { query, rows, total, tookMs, plan, warnings } = result;
  return isDev ? { query, rows, total, tookMs, plan, warnings } : { rows, total, tookMs };
}

export const branches = new Hono();

branches.get("/regions", (c) => c.json(envelope(listRegions())));

branches.get("/", (c) => {
  const raw = c.req.query("region");
  const regionId = raw ? Number(raw) : null;
  if (raw && !Number.isInteger(regionId)) {
    return c.json({ error: "region must be an integer region id" }, 400);
  }
  return c.json(envelope(listBranches({ regionId })));
});
