// Credit status. The verdict is the part worth pinning: it is what a counter hand acts on,
// and every branch of it changes whether goods leave the building.

import { test, expect } from "bun:test";
import { getCreditSummary, listInvoices, verdictFor, BANDS } from "../server/queries/credit.js";
import { db } from "../server/db.js";

const ASOF = "2026-08-04"; // pinned: a generated dataset ages, and buckets would drift

test("verdictFor covers every state that changes what happens at the counter", () => {
  const base = { accountType: "credit", creditStatus: "normal", limitPence: 100000 };

  // On stop beats everything, including a healthy balance — that is the point of it.
  expect(verdictFor({ ...base, creditStatus: "on_stop", outstandingPence: 0 })).toBe("on_stop");
  expect(verdictFor({ ...base, accountType: "cash", outstandingPence: 5000 })).toBe("cash");
  expect(verdictFor({ ...base, limitPence: 0, outstandingPence: 0 })).toBe("no_limit_set");
  expect(verdictFor({ ...base, outstandingPence: 100001 })).toBe("over_limit");
  expect(verdictFor({ ...base, outstandingPence: 90000 })).toBe("near_limit");
  expect(verdictFor({ ...base, outstandingPence: 89999 })).toBe("ok");

  // Exactly at the limit is not over it.
  expect(verdictFor({ ...base, outstandingPence: 100000 })).toBe("near_limit");
});

test("the ageing bands account for the whole outstanding balance", () => {
  // If they did not, the bar would be a lie: someone reads four buckets and assumes they
  // add up to what is owed.
  const customerId = db
    .query(`select customer_id as id from aged_debt where unpaid_pence > 0
             group by 1 order by count(*) desc limit 1`)
    .get().id;

  const s = getCreditSummary(customerId, { asOf: ASOF });
  const banded = s.bands.reduce((n, b) => n + b.pence, 0);
  expect(banded).toBe(s.outstandingPence);
  expect(s.bands.map((b) => b.id)).toEqual(BANDS.map((b) => b.id));
});

test("outstanding counts only unpaid invoices, not the whole ledger", () => {
  const customerId = db
    .query(`select customer_id as id from aged_debt group by 1
             having sum(case when unpaid_pence = 0 then 1 else 0 end) > 0
                and sum(case when unpaid_pence > 0 then 1 else 0 end) > 0
             order by customer_id limit 1`)
    .get().id;

  const s = getCreditSummary(customerId, { asOf: ASOF });
  const unpaidOnly = db
    .query(`select coalesce(sum(unpaid_pence),0) as c from aged_debt
             where customer_id = ?1 and unpaid_pence > 0`)
    .get(customerId).c;
  const everything = db
    .query(`select coalesce(sum(goods_pence + tax_pence),0) as c from aged_debt where customer_id = ?1`)
    .get(customerId).c;

  expect(s.outstandingPence).toBe(unpaidOnly);
  expect(s.outstandingPence).toBeLessThan(everything);
});

test("a cash account gets no limit or headroom", () => {
  // Showing "£0 limit, £0 headroom" would read as a credit account that had been zeroed.
  const customerId = db
    .query(`select c.id from customer c where c.account_type = 'cash'
             and exists (select 1 from aged_debt a where a.customer_id = c.id) limit 1`)
    .get().id;

  const s = getCreditSummary(customerId, { asOf: ASOF });
  expect(s.verdict).toBe("cash");
  expect(s.headroomPence).toBeNull();
});

test("headroom goes negative rather than clamping at zero", () => {
  const over = db
    .query(`select c.id from customer c where c.account_type = 'credit'
             and (select coalesce(sum(unpaid_pence),0) from aged_debt a where a.customer_id = c.id)
                 > c.credit_limit_pence
             order by c.id limit 1`)
    .get();
  if (!over) return;

  const s = getCreditSummary(over.id, { asOf: ASOF });
  expect(s.verdict).toBe("over_limit");
  expect(s.headroomPence).toBeLessThan(0);
  expect(s.headroomPence).toBe(s.limitPence - s.outstandingPence);
});

test("filtering to an age band narrows the list to that band", () => {
  const customerId = db
    .query(`select customer_id as id from aged_debt where unpaid_pence > 0
             group by 1 order by count(*) desc limit 1`)
    .get().id;

  const all = listInvoices(customerId, { view: "unpaid", asOf: ASOF, limit: 200 });
  let banded = 0;
  for (const band of BANDS) {
    const page = listInvoices(customerId, { view: "unpaid", band: band.id, asOf: ASOF, limit: 200 });
    banded += page.matchCount;
    // Every row really is in the band it was filtered to.
    for (const row of page.rows) {
      expect(row.age_days).toBeGreaterThanOrEqual(band.from);
      if (band.to !== null) expect(row.age_days).toBeLessThan(band.to);
    }
  }
  // The bands partition the unpaid set — no invoice in two bands, none in none.
  expect(banded).toBe(all.matchCount);
});

test("the unpaid view is a subset of the recent view", () => {
  const customerId = db
    .query(`select customer_id as id from aged_debt group by 1
             having count(*) > 20 order by customer_id limit 1`)
    .get().id;

  const unpaid = listInvoices(customerId, { view: "unpaid", asOf: ASOF, limit: 200 });
  const recent = listInvoices(customerId, { view: "recent", asOf: ASOF, limit: 200 });

  expect(unpaid.matchCount).toBeLessThanOrEqual(recent.matchCount);
  expect(unpaid.rows.every((r) => r.unpaid_pence > 0)).toBe(true);
});

test("asOf moves the buckets, so a pinned date keeps fixtures stable", () => {
  const customerId = db
    .query(`select customer_id as id from aged_debt where unpaid_pence > 0
             group by 1 order by count(*) desc limit 1`)
    .get().id;

  const now = getCreditSummary(customerId, { asOf: ASOF });
  const later = getCreditSummary(customerId, { asOf: "2027-08-04" });

  // Same money either way — only its age changes.
  expect(later.outstandingPence).toBe(now.outstandingPence);
  // A year on, everything has aged past 90 days.
  expect(later.bands.find((b) => b.id === "90").pence).toBe(later.outstandingPence);
});

test("the credit queries use the index rather than scanning 1.1M rows", () => {
  // This index is the one this project measured into datagenerator2 (37.83ms -> 0.01ms).
  // Asserting the plan, not the timing, so the test does not flake on a loaded machine.
  const plan = db
    .query(`explain query plan select sum(unpaid_pence) from aged_debt ad
             where ad.customer_id = 1 and ad.unpaid_pence > 0`)
    .all()
    .map((r) => r.detail)
    .join(" ");
  expect(plan).toContain("ix_aged_debt_customer_date");
  expect(plan).not.toContain("SCAN aged_debt");
});
