// server/routes/products.js — product reads for quantity entry.

import { Hono } from "hono";
import { getQtyConfig, listTallies } from "../queries/products.js";
import { isDev } from "../db.js";

export const products = new Hono();

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
