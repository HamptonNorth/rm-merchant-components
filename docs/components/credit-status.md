# credit-status

`<merchant-credit-status>` — can this customer have the goods?

## Current version: 0.1.0

**It states a verdict, not a set of numbers.** "£4,120.31 outstanding against a £2,500.00
limit" needs arithmetic at a counter with somebody waiting; **OVER LIMIT** does not. The
figures are there underneath for anyone who wants them.

| Verdict | When | Note shown |
|---|---|---|
| `on_stop` | `credit_status = 'on_stop'` — 613 customers | Do not release goods. Refer to the account manager. |
| `over_limit` | outstanding > limit | Outstanding balance exceeds the credit limit. |
| `near_limit` | outstanding ≥ 90% of limit | Little headroom left — check the order value. |
| `ok` | otherwise | — |
| `cash` | `account_type = 'cash'` | No credit facility — settle at the counter. |
| `no_limit_set` | credit account, no limit on file | Credit account with no limit on file. |

`on_stop` beats everything, including a healthy balance — that is the point of it.
`near_limit` exists because "£180 left of £5,000" is the case where someone should pause
before loading a van, and it is invisible if you only flag going over.

A cash account shows **no limit and no headroom** rather than zeros, which would read as a
credit account that had been zeroed.

## Two tiers, two calls

The summary and the invoice list load separately and deliberately. Somebody waiting on a
hundred-row list to discover an account is on stop is waiting for the wrong thing.

Both are served by the index this project measured into datagenerator2 —
`aged_debt(customer_id, transaction_date)`, 37.83 ms → 0.01 ms over 1.14M rows. A test
asserts the query plan still uses it.

## Ageing

Four buckets — current, 30, 60, 90+ — as a proportional bar over clickable totals. They
**partition the unpaid balance**: every unpaid invoice is in exactly one, and the four sum
to outstanding. A test pins that, because four buckets that do not add up to the total is a
bar that lies.

Clicking a bucket filters the invoice list to it, which is the natural next question after
seeing £16 sitting in 90+. Empty buckets are dimmed and not clickable.

`asOf` sets the reference date and defaults to today. Pin it in fixtures: a generated
dataset ages, and without pinning every example drifts into 90+ and the buckets stop
demonstrating anything.

## Properties

| Property | Attribute | Type | Default | Notes |
|---|---|---|---|---|
| `customerId` | `customer-id` | number \| null | `null` | Customer to check. |
| `asOf` | `as-of` | string | `""` | Ageing reference date, `YYYY-MM-DD`. Blank uses today. |
| `view` | `view` | `unpaid` \| `recent` | `unpaid` | Unpaid only, or all recent invoices. |
| `showInvoices` | `show-invoices` | boolean | `true` | Off leaves just the verdict and ageing. |
| `dense` | `dense` | boolean | `false` | Tighter invoice rows. |
| `pageSize` | `page-size` | number | `10` | Invoices per page. |

## Events

| Event | Detail | When |
|---|---|---|
| `merchant-credit-checked` | `{ customerId, verdict, outstandingPence, headroomPence, limitPence, unpaidCount, oldestUnpaidDays }` | After the summary loads. |
| `merchant-invoice-selected` | `{ customerId, invoiceNumber, transactionDate, grossPence, unpaidPence, ageDays }` | An invoice row is clicked. |

`headroomPence` is **negative when over the limit** rather than clamped at zero — a host
deciding whether to allow an order needs the size of the overshoot, not just its existence.
It is `null` for cash accounts, which have no limit to have headroom against.

## What the data cannot show

Recorded because it shapes what is worth building (docs/plan.md §7.5):

- **No credit notes and no payments.** All 1,141,260 rows are `transaction_type = 'invoice'`,
  so a balance only ever goes up until an invoice is marked paid.
- **No part-paid invoices.** `unpaid_pence` is either `0` or the full gross. A part-payment
  column would be dead code against this dataset.

The component handles both correctly anyway — they are cheap now and awkward to retrofit —
but nothing here exercises them.

## Data

`customer` + `aged_debt` + `branch`, via `GET /api/customers/:id/credit?asOf=` and
`GET /api/customers/:id/invoices?view=&band=&sort=&limit=&offset=&asOf=`. Typical volumes:
40 invoices per customer, 7.4 unpaid; the heaviest holds 577 and 103.

The invoice list reports `matchCount` and `truncated` alongside the returned page, so a page
is never mistaken for the whole ledger.

## Changelog

### 0.1.0 — 2026-08-04

Initial version. Verdict, limit/outstanding/headroom, four-band ageing with click-to-filter,
and a paged unpaid/recent invoice list sortable by date or value.
