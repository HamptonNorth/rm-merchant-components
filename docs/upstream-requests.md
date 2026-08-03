# Upstream requests → datagenerator2

Schema and data changes this project needs from
`github.com/HamptonNorth/datagenerator2`, per plan decision #6: schema work lands upstream
and is generated with realistic data, rather than being patched into a local copy.

Source of truth for the schema is `datagenerator2/src/db/schema.js`; naming rules are
`datagenerator2/docs/NAMING.md`. Rationale for each item lives in the linked plan section —
this file is the handover package, not a second copy of the reasoning.

Ordered by what unblocks the most work.

---

## 1. Permissions, roles and approval escalation

**→ Full spec: [`requirements-permissions.md`](requirements-permissions.md)** — DDL, seed
data, generation rules and verification queries, written to be worked from directly.
Design rationale in [plan §7.7](plan.md).

**Status:** agreed 2026-08-01, **next to build**. Wanted before further components, so they
are developed against real permission data rather than fixtures.

Three new tables plus changes to `app_role` and `branch`. `app_role` keeps holding job
functions — a different concept from permissions, and the two must not be merged — but
gains a `code` for logic to key on, an `approval_rank` to order the escalation chain, and
two new roles:

| rank | role | covers |
|---:|---|---|
| 1 | Manager | one branch |
| 2 | Regional manager (new) | every branch in one of the 8 regions |
| 3 | Head office (new) | every trading branch, no limits |

Head office holding no limits is what guarantees the escalation chain always terminates.
Approval capability is not a separate permission: an approver is someone holding the same
permission at a higher rank with enough headroom.

```sql
CREATE TABLE permission (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  description TEXT, category TEXT NOT NULL, scope TEXT NOT NULL,
  is_limited INTEGER NOT NULL, sort INTEGER
);

CREATE TABLE app_user_branch (
  id INTEGER PRIMARY KEY, app_user_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
  app_role_id INTEGER NOT NULL, is_default INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_app_user_branch ON app_user_branch(app_user_id, branch_id);

CREATE TABLE app_user_permission (
  id INTEGER PRIMARY KEY, app_user_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL, approval_limit_pence INTEGER
);
CREATE UNIQUE INDEX ux_app_user_permission
  ON app_user_permission(app_user_id, branch_id, permission_id);
CREATE INDEX ix_app_user_permission_branch
  ON app_user_permission(branch_id, permission_id);
```

Reading the source matrix — the part most likely to be got wrong:

- **Y/N is granted / not granted.** `raise_purchase_order` `Y` = may raise POs.
  `raise_purchase_order_any_supplier` `N` = may not, so they are confined to the default
  supplier.
- **Only granted permissions get a row.** An `N` cell produces no row at all; absence is
  the only "not granted".
- **The limit is an auto-approval threshold, not a ceiling.** `Y` with 1500 means raise
  freely up to £1500 ex-VAT, above which it routes to the branch manager. The action is
  never refused outright. Boundary is exclusive: `value > limit` routes.
- **A limit on an `N` row is meaningless — do not carry it across.** Those are leftover
  template values in the spreadsheet. `raise_purchase_order_any_supplier` `N` 100 does
  *not* mean "any supplier up to £100".
- **NULL `approval_limit_pence` means no threshold**, i.e. never routes — not "always
  routes". `override_selling_prices` is constrained by margin band, not by value.
- **Integer pence** (rule 6): the matrix's `1500` is `150000`.

Applying that, the sample row (user 1, branch 1) yields **nine** grant rows, not fifteen.

Generation should be realistic rather than uniform: Counter staff at one branch, Sales at
two or three within a region, Managers at one, and permission sets that differ by role —
otherwise every component renders identically and nothing gets tested. Seed catalogue of 15
permissions in plan §7.7.

**Open before generation** (full list in the spec, §8): whether Head Office gets its own
`branch` row — recommended, but it takes the branch count to 29 and operational pickers
must then filter `branch_type = 'trading'`; the `scope` value for each of the 15
permissions; and whether permission id 5 is a deliberate gap.

**Open before enforcement, not generation:** which threshold applies when a user holds both
`sales_counter` (£500) and `sales_desk` (£1,000).

---

## 1b. Counter quick codes and branch neighbours

**→ Full spec: [`requirements-customer-search.md`](requirements-customer-search.md)**

**Status:** agreed 2026-08-03. Blocks two of find-customer's four search routes; the
postcode/name/account-code search works without it.

Two small tables plus 28 counter cash accounts:

- `branch_quick_code` — digit 1–9 **per branch** → a cash account, so a single keystroke
  reaches the everyday account and takings attribute to the branch that made the sale.
- `branch_neighbour` — curated, 2–4 per branch, for the widen control. Deriving it from
  `region_id` would defeat the point: Cardiff and Bristol are 45 minutes apart across a
  regional boundary, and Stockport and Sheffield are 40 miles apart with the Peak District
  between them. Twelve of 28 branches have a neighbour outside their own region.

Until they land, find-customer searches the working branch and widens straight to all
branches, skipping the neighbour step.

## 2. Indexes — [plan §7.2](plan.md)

**Status:** one measured, the rest proposed. The dataset ships with no explicit indexes
(two implicit `sqlite_autoindex` entries exist from `UNIQUE` on `supplier.code` and
`product.code`).

**Measured, not estimated** — on a scratch copy, 5-run mean:

```sql
CREATE INDEX idx_aged_debt_customer_date ON aged_debt(customer_id, transaction_date);
```

| Credit-status query | Before | After |
|---|---:|---:|
| Ageing-bucket aggregate | 37.83 ms | **0.01 ms** |
| Unpaid list, date-sorted | 28.65 ms | **0.04 ms** |
| Recent list, date-sorted | 29.22 ms | **0.02 ms** |

Build cost 260 ms; file size unchanged. The trailing `transaction_date` also satisfies
`ORDER BY`, removing the temp B-tree — `aged_debt(customer_id)` alone would not.

Also wanted:

```sql
customer(home_branch_id)
customer(postcode    COLLATE NOCASE)   -- NOCASE or a prefix LIKE will not use it
customer(account_code COLLATE NOCASE)  -- ditto
customer_contact(customer_id)
customer_delivery_address(customer_id)
product(name), product(product_group_id), product(default_supplier_id)
product_price(product_id)
branch(region_id)
```

`customer(name)` is deliberately absent: no B-tree serves an unanchored `LIKE '%…%'`.
That is the FTS5 case — **trigram** tokenizer, so results match `LIKE` exactly. See
[`requirements-customer-search.md`](requirements-customer-search.md) §3 for the measurements
and DDL. Justified by scale rather than by today: 2.9 ms at 39k rows, 25.3 ms at 394k, and
0.01 ms with FTS at either size.

---

## 3. Stock — [plan §7.1](plan.md)

**Status:** blocking two components (`stock-check`, `multi-branch-stock`), which are built
against a fixture provider until this lands.

No table links product to branch. Proposed `stock`: `product_id`, `branch_id`,
`is_stocked_item`, `on_hand_qty`, `allocated_qty`, `on_order_qty`, `on_order_eta`,
`min_qty`, `max_qty`, `reorder_qty`, `bin_location`, `last_counted_at`, `updated_at`;
unique on `(product_id, branch_id)`. Roughly 30–50k rows if branches stock a realistic
subset of the 3,714 products rather than the full 103,992 cross-product.

Needs deciding: **tally products** (27 of them) carry per-length tallies, and real stock for
those is a quantity *per length*. Recommendation is an aggregate quantity now and a
`stock_tally_line` child table later, so the components are not held up.

Realism matters here more than elsewhere: some products out of stock everywhere, some at
one branch only, some below reorder level, some with `allocated > on_hand`. Flat random
data makes every component look the same.

---

## 4. Foreign keys — [plan §7.3](plan.md)

`pragma foreign_key_list(customer)` returns empty — no FKs are declared anywhere. Declaring
them makes the dataset self-documenting and lets this project's queries be checked against
real constraints.

One blocker: `product.tally_id` uses `0` for "none" rather than `NULL`, which needs
normalising before an FK can be added.

---

## 5. National-account ownership — [plan §7.8](plan.md)

52 of 39,087 customers are `is_national_account`, but the schema can only express branch
ownership — they still carry an ordinary `home_branch_id`, and there is no head-office
branch or large-accounts-manager field. Options: nullable `customer.owning_sales_rep_id`, a
head-office pseudo-branch, or a `customer.ownership_type` enum
(`branch` / `regional` / `head_office`).

Worth settling before `credit-status` renders "owned by", since that component states who
holds the credit relationship.

---

## 6. Ledger realism — [plan §7.5](plan.md)

Optional. Today's `aged_debt` is cleaner than a real ledger, so some states can never be
exercised:

- All 1,193,303 rows are `transaction_type = 'invoice'` — **no credit notes, no payments**.
- `unpaid_pence` is only ever `0` or the full gross — **no part-paid invoices**.
- Every customer and every product is `active` — archived paths are untestable.

644 customers are `on_stop`, which is enough to exercise that path.

The credit-status component is built to handle credit notes and part-payments regardless,
since those are cheap up front and expensive to retrofit.
