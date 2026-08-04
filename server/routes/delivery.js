// server/routes/delivery.js — GET /api/customers/:id/delivery-addresses

import { Hono } from "hono";
import { listDeliveryAddresses } from "../queries/delivery.js";
import { isDev } from "../db.js";

export const delivery = new Hono();

delivery.get("/:id/delivery-addresses", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  const includeArchived = c.req.query("includeArchived") === "1";
  const result = listDeliveryAddresses(id, { includeArchived });
  const { query, rows, total, tookMs, plan, warnings, archivedCount } = result;

  return c.json({
    ...(isDev ? { query, plan, warnings } : {}),
    rows,
    total,
    tookMs,
    archivedCount,
    includeArchived,
  });
});
