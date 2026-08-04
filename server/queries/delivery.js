// server/queries/delivery.js — where is this order going?
//
// A cash sale can be concluded at the counter and delivered next Wednesday, and an order
// that started as a collect can turn into a delivery as lines are added, so this is reachable
// from anywhere in the order flow rather than only from a "delivery" branch of it.

import { measured } from "../db.js";

const SELECT_ADDRESS = `
  select d.id, d.customer_id, d.name,
         d.address_1, d.address_2, d.town, d.county, d.postcode, d.country,
         d.telephone, d.project_reference, d.plus_code, d.what3words,
         d.delivery_instructions, d.unload_method, d.added, d.archived
    from customer_delivery_address d`;

export function listDeliveryAddresses(customerId, { includeArchived = false } = {}) {
  const where = includeArchived
    ? `d.customer_id = ?1`
    : `d.customer_id = ?1 and d.archived = 0`;

  const result = measured(
    "delivery.list",
    // Project reference first, then town: someone delivering to "Kirkby site" looks for the
    // job, not the postcode.
    `${SELECT_ADDRESS} where ${where} order by d.archived, d.project_reference, d.town, d.id`,
    [customerId],
  );

  const archivedCount = includeArchived
    ? result.rows.filter((r) => r.archived).length
    : measured(
        "delivery.archivedCount",
        `select count(*) as c from customer_delivery_address where customer_id = ?1 and archived = 1`,
        [customerId],
      ).rows[0].c;

  return { ...result, archivedCount, includeArchived };
}
