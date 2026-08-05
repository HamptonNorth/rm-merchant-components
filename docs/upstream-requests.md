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

## 2b. Address columns, punctuation and diacritic normalisation in `customer_fts`

**Status:** working without it; wanted before the customer count grows.

find-customer searches addresses as a separate route (`Stead Lane` → the customers on it),
but `address_1`/`address_2` are not in the FTS index, so it falls back to a `LIKE` scan.

| | 39,452 customers | ~400k projected |
|---|---:|---:|
| address `LIKE`, worst case | 3.4 ms | ~34 ms |
| name via trigram FTS | 0.06 ms | 0.06 ms |

Affordable now, and mitigated by only running the address route when the cheaper routes have
not filled the page. The change is to add the two columns to the existing `CUSTOMER_FTS`
definition and its populate statement:

```sql
CREATE VIRTUAL TABLE customer_fts USING fts5(
  name, town, address_1, address_2,
  content='customer', content_rowid='id', tokenize='trigram');
```

### Normalised text alongside the verbatim columns

The index stores names verbatim, which makes two whole classes of search silently miss.
Neither can be fixed consumer-side: normalisation has to happen where the index is built.

**Punctuation.** 13,112 of 39,452 customer names contain a full stop, so `N.R.` and `NR` are
different strings and someone typing `NR Willis` does not find "N.R. Willis". Stripping
`. ' - , & !` and collapsing whitespace fixes it, and the same pass covers the apostrophes
and hyphens that a real ledger has and this generated one does not (0 apostrophes and 1
hyphen in the current data — absence in the fixture, not in the world).

**Diacritics.** Only 28 rows are non-ASCII today, so this earns nothing measurable against
the current dataset. It is worth doing anyway *because it rides on the same pass*: a real
merchant's ledger holds Polish, Portuguese and Irish trade names, and `Müller` / `Muller` /
`Mueller` should be one customer. Folding to ASCII costs nothing extra once text is being
rewritten.

Suggested shape — normalised columns beside the verbatim ones, so exact display is
unaffected and search has something canonical to match against:

```sql
CREATE VIRTUAL TABLE customer_fts USING fts5(
  name, town, address_1, address_2,        -- verbatim, for display and exact matching
  name_norm, address_norm,                 -- punctuation-stripped, diacritic-folded, lower
  content='customer', content_rowid='id', tokenize='trigram');
```

The consumer then searches `name_norm:` with an equally normalised query term, and the
verbatim columns stay available for ranking an exact spelling above a normalised one.

Doing both in one pass matters: each is a regeneration cycle on its own, and the diacritic
half is free once the punctuation half is being done.

---

## 2c. Interchange codes and buying currency (cXML punchout)

**Status:** decided 2026-08-04, not blocking. Wanted before a catalogue is exposed to a
buyer's procurement system; find-product and product-detail do not depend on it.

For cXML punchout these are interface requirements rather than refinements — Ariba and Coupa
validate `UnitOfMeasure` against UN/ECE Rec 20, `Money` carries an ISO 4217 attribute, and a
buyer's spend analytics and approval routing key off the UNSPSC `Classification`. Without
them a punchout either rejects or lands as unclassified spend.

```sql
unit_of_measure.unece_code   TEXT   -- UN/ECE Rec 20: EA, MTR, KGM, MTK, TNE, LTR, BG, RO...
product_group.unspsc_code    TEXT   -- 91 leaf groups to map; an afternoon, not a project
supplier.currency_code       TEXT NOT NULL DEFAULT 'GBP'   -- ISO 4217
```

**The UOM mapping is not one-to-one, and that is the part worth knowing before scoping it.**
`unit_of_measure` conflates the physical unit with the pricing denominator — the divisor
spread is `[1, 2, 10, 12, 20, 100, 336, 400, 500, 1000]`, where 336 is a brick pallet and 12
a dozen. UN/ECE codes the unit only; it has nothing for "priced per 336". Six of the 26 rows
therefore map to `EA` and are separated solely by `divisor`. The existing `divisor` column
already carries what is needed as the price basis, so the model can express it — but a
lookup table alone cannot, and assuming otherwise is the way this gets underestimated.

### Currency applies to buying only

Decided: **every selling transaction is GBP.** Customers, aged debt, selling prices and
credit limits stay as they are — integer pence, GBP implied — and need no change. Currency
enters only on the buying side, where timber comes from Scandinavia, hardwoods from Canada,
the USA and Africa, and bricks from Turkey.

### Three buying models, run simultaneously

Which model applies is a property of the **supplier relationship**, not a company-wide
setting: a merchant buys Toolstation in GBP, a Swedish mill in SEK, and Canadian hardwood
through its own buying department, all at once.

| # | Model | FX borne by | Schema today |
|---|---|---|---|
| 1 | Direct import, priced in the supplier's currency | the merchant | not expressible — `supplier` has no currency |
| 2 | Import agent quotes an agreed GBP price | the agent | **the only one supported**; all 26 suppliers are this |
| 3 | Internal overseas buying department — the branch orders in GBP, specialists handle procurement and accounting | the group, centrally | not expressible — no internal-supplier concept |

Model 1 needs `supplier.currency_code` and currency-carrying purchase orders. Model 3 needs
something new: a supplier that is **internal**, representing central buying rather than an
outside trading entity.

Two pieces of model 3 already exist and fit:

- **Head Office is already a branch** (`branch_type = 'head_office'`, id 29), which is where
  a central buying department belongs.
- **`raise_purchase_order` versus `raise_purchase_order_any_supplier`** already encodes "you
  may only buy from the default supplier". For an imported line whose default supplier *is*
  the internal buying department, that permission is precisely the control that keeps a
  branch from going direct to the mill. The mechanism is in place; only the supplier type is
  missing.

Suggested: `supplier.supplier_type` (`external` | `internal`) plus a nullable
`supplier.branch_id` pointing at Head Office for internal ones. `product.default_supplier_id`
then points at the internal buyer for lines the branch may not source itself, and
`allow_direct_ex_works` (already set on 437 products) keeps its meaning of shipping from the
mill straight to site.

### Transfer price is not landed cost

The point most likely to be discovered late, and the one with a business consequence.

Under model 3 the branch is charged a **transfer price**, which central buying may set above
actual landed cost — to cover its own costs, or to absorb FX variance so branches see a
stable GBP figure. So two different numbers exist for the same timber:

| number | drives |
|---|---|
| what the branch was charged (GBP transfer price) | branch margin, and the branch manager's figures |
| what the group actually paid (SEK, converted) | group margin, and what finance reconciles |

`product.last_cost_pence` and `weighted_average_cost_pence` currently hold one number. Under
models 1 and 2 that is unambiguous. Under model 3 it is not, and storing only one means one
of the two margin reports is quietly wrong — which surfaces as a branch manager's figures
disagreeing with finance and nobody able to say which is right.

`product.last_cost_pence` and `weighted_average_cost_pence` **stay GBP** and that is correct:
they are landed cost after conversion, not transaction amounts. Recorded so nobody later
"fixes" them into supplier currency.

When purchase-order and supplier-invoice tables are built, each money row should carry
**three** things, not two:

| | why |
|---|---|
| amount in the supplier's currency | reconciling their invoice means matching the figure they sent |
| the exchange rate applied | must be the rate used *at the time* |
| the GBP equivalent | costing, margin and reporting |

Storing the foreign amount plus a rate *table* and recomputing later is the classic mistake:
rates move, a historical purchase order then reconciles differently than it did, and the
difference surfaces as unexplained pennies in cost.

**Data gap:** all 26 suppliers are UK, including the three named as importers (Anglian
Plywood Importers, Baltic Softwood Supplies, Northgate Timber Importers). Nothing exercises
foreign-currency buying. A few overseas suppliers with non-GBP `currency_code` — a Swedish
sawmill, a Turkish brickworks, a Canadian hardwood mill — would make it testable.

---

## 2d. Product ranging — which branches carry which lines

**→ Full spec: [`requirements-product-ranging.md`](requirements-product-ranging.md)** — DDL,
generation rules, verification queries and the measurements behind the shape.

**Status:** **built and generated, 2026-08-04** — `product_branch`, 47,704 rows. The
prerequisite half of §3 below, split out because it is small and §3 is not: ranging is a
three-column table, while `stock` is the whole inventory model. Separating them let
`find-product` proceed without waiting for the inventory model.

Nothing links product to branch, so a search can only offer every product at every branch —
wrong the first time someone searches for a line their branch has never carried. One sparse
table fixes it:

```sql
CREATE TABLE product_branch (
  id INTEGER PRIMARY KEY, product_id INTEGER, branch_id INTEGER,
  status TEXT NOT NULL,   -- core | stocked | non_stock | not_permitted
  ranged_at TEXT
);
CREATE UNIQUE INDEX ux_product_branch        ON product_branch(product_id, branch_id);
CREATE INDEX        ix_product_branch_branch ON product_branch(branch_id, product_id);
```

The parts most likely to be got wrong:

- **Absence is the "not stocked" state and must not be stored.** Storing the negative costs
  3.17M rows saying "no" at large-merchant scale, and a second place for the truth to drift.
  Absence means *not ranged but still sellable*, as a special order.
- **Core is a status on the row, not a flag on `product`.** A product-level flag breaks on
  the first exception — the specialist branch carrying no core timber — and then needs an
  exception table. It also conflates a national merchandising decision with a per-branch
  service level.
- **`not_permitted` is the one negative that earns a row**, because it has to beat the
  special-order default: the branch with no accreditation, or age-restricted lines where
  there is no process to check ID.
- **`non_stock` is today's `stock.is_stocked_item = 0`** — sold here, never held. Kept
  because it changes search ordering, which absence cannot express.
- **This replaces `stock.is_stocked_item`**, which moves here. Nothing else on `stock`
  changes, and the specialist-branch design in §3 is unaffected.
- **No FK from `stock` to `product_branch`.** Residual stock of a delisted line is real.

Measured at 25,000 products × 150 branches: **579,844 rows, 11.4 MB** — 15.5% of the full
matrix, every query at or under 0.06 ms. Both index directions are needed;
`(branch_id, product_id)` alone leaves "which branches stock this product" at 9 ms, which is
`multi-branch-stock`'s whole job.

A trial run over the real product and branch tables measured **42,659 rows** across the
**28 trading branches** — head office (`branch_type = 'head_office'`) gets no ranging rows,
it sells nothing — consistent with §3's existing "roughly 30–50k rows" estimate. The DDL and
all five verification queries in the spec were run against it.

One generation rule is easy to get backwards: **designate the ranged-nowhere tail before
ranging anything, not after.** With 28 branches each drawing ~800 of 3,714 products
independently, almost nothing survives unranged and the tail disappears — and that tail is
the special-order path. How far the measured figure drifts above the designated one depends
on how hard the group bias is: the shipped settings measure 13.9% against a designated 14%,
while an early trial with a much harder bias designated 20% and measured 29.3%. Generation
logs it every run and warns outside a 10–30% band.

**Data gap, same component: barcodes are 5% populated.** 185 of 3,714 products carry a
`barcode_inner`, and `barcode_outer` and `barcode_pallet` are empty on every row.
`find-product` searches by code, name **or barcode**, and scanning at the counter is an
everyday workflow, so that route cannot be exercised. Generation change only — the columns
exist. Outer and pallet barcodes matter separately from inner: scanning a shrink-wrapped
pack should find the pack, not the piece.

**No product FTS is needed** — noting it so it does not get built by analogy with
`customer_fts`. Unindexed `LIKE` scans over all 3,714 products measure 0.01–0.35 ms, and
extrapolate to ~2.3 ms at a 25,000-product catalogue. FTS earned its place at 39,452
customers; the catalogue is an order of magnitude smaller. `product_group.path` is already
a materialised path (`Top.Timber.Joinery.Sawn`), so subtree faceting needs nothing either.

---

## 2e. A `view_cost` permission, and what `tier` actually means

**Status:** neither blocking. Both found while building `product-detail`.

**No permission covers seeing cost or margin.** The 15 permissions cover sales, credit,
purchasing, stock and works orders. `product-detail` therefore puts cost behind a `showCost`
prop that defaults off and says on screen that it is ungated. `override_selling_prices` is
not a substitute — that governs *changing* a price, not *seeing* what it cost. Counter staff
generally may not see cost; sales desk and managers may.

**`product_price.tier` means two different things depending on the product's scheme**, and
the schema does not say which:

| | products | `tier` is |
|---|---:|---|
| degenerate scheme, `qty_from = qty_to = 1` | 3,697 | a customer price band (prices simply descend) |
| "Cement and bagged binders" | 17 | a genuine quantity break, 1-9 / 10-25 / 26-50 / 51-9999 |
| "Kronospan decorative sheets" | 0 | real ranges defined, no product uses them |

Consumers must test the scheme before rendering a tier as a quantity, or they will print
"qty 1-1" against 99.5% of the catalogue. Two smaller inconsistencies alongside it: **464
products carry more price rows than their scheme has tiers** (the 17 quantity-break lines all
have 6 prices against a 4-tier scheme), and **no customer carries a price band**, so nothing
connects a customer to the tier they should be charged at — which is the obvious next step
for a counter system.

Also worth knowing for any consumer: **`unit_of_measure.description` is internal
configuration guidance**, not a display label. It reads "Use for unit products. Qty x price
with divisor of 1", and rendering it produces "Weight: 2.38 Use for unit products…".

---

## 3. Stock, sourcing and inter-branch supply

**→ Full spec: [`requirements-stock-sourcing.md`](requirements-stock-sourcing.md)**

**Status:** blocking `stock-check` and `multi-branch-stock`, which are built against a
fixture provider until this lands.

No table links product to branch. Beyond the obvious quantities, working through it showed
that **cost, replenishment route and supplier all vary by branch too**, and the schema holds
each of them once per product:

- `stock` per `(product, branch)` — quantities, **and** `last_cost_pence` /
  `weighted_average_cost_pence`, because branch 5 buys girders well and my branch does not.
- `replenish_method` per `(product, branch)` — from a supplier depot, direct to site, always
  IBT'd from a nominated branch, or machined to order at one. A made-to-order product with
  zero on hand everywhere is not out of stock, and without the route the component says it is.
- `product_supplier` many-to-many with a preference order, `supplier_location` depots under a
  single settlement account, and `branch_accreditation` — because a branch without the
  accreditation cannot buy direct from the manufacturer and structurally pays more.

It also now covers **product compliance** — FSC/PEFC chain of custody, which currently lives
as a substring in 237 product names, hazardous-goods documentation for the 19 chemical,
paint, sealant and cement groups, and age-restricted supply of bladed articles and
corrosives. Note that `is_residential` is already computed on the `address_pool` staging
table and discarded when it is dropped; corrosives cannot be delivered to residential
premises, so it needs carrying through to `customer_delivery_address`. Both need the same two halves: the fact on the product, and
an auditable record of what was issued to which customer and when. Holding a safety data
sheet is not the obligation; issuing it, and re-issuing it on revision, is.

Generation realism matters more here than elsewhere: at least one **specialist branch**
stocking a whole category for the others to IBT from, some products out of stock everywhere,
some below reorder, some with `allocated > on_hand`. Flat data makes every component look
identical.

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
