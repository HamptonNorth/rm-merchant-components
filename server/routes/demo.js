// server/routes/demo.js — the outward-facing door.
//
// Deliberately its own namespace rather than a flag on /api/harness. The harness is a
// development tool: it reports SQL plans, query timings and the list of things this dataset
// cannot demonstrate. None of that should be one query parameter away from a prospect, and a
// separate route makes the boundary something you have to cross on purpose.
//
// This only ever calls listDemoFeatures(), which filters by allowlist. A probe added without
// an `audience` is internal, so the failure mode of forgetting is "a demo is missing"
// rather than "a weakness is published".

import { Hono } from "hono";
import { listDemoFeatures } from "../queries/features.js";

export const demo = new Hono();

demo.get("/features", (c) => {
  const r = listDemoFeatures({
    q: c.req.query("q") ?? "",
    limit: Math.min(Number(c.req.query("limit") ?? 5) || 5, 10),
  });
  // No plans, no timings, no entity facets — those are development facts.
  return c.json({
    rows: r.rows.map(({ id, label, why, component, total, examples }) => ({
      id,
      label,
      why,
      component,
      total,
      examples: examples.map(({ id, label, detail, props }) => ({ id, label, detail, props })),
    })),
    total: r.rows.length,
  });
});
