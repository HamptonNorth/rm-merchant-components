# rm-merchant-components — Plan

**Status:** draft for approval · **Date:** 2026-08-01

A component library plus a development harness for builders'-merchant UI components.
Bun + Hono on the server, Lit + Tailwind in the browser, plain JavaScript throughout
(no TypeScript, matching `datagenerator2`). Data comes from the generated
`datagenerator.db`.

---

## 0. Who uses these

**Merchant staff, not customers.** The users are counter and sales-desk staff — closer to
retail till operators than to end customers. Every component is an internal tool operated
by a signed-in `app_user`, and that shapes the defaults: dense information, keyboard speed,
and business facts (credit status, ownership, stock) shown plainly rather than softened.

The dataset has 175 `app_user` rows across all 28 branches (5–7 each) in four roles —
Sales 67, Counter 45, Purchasing and stock 35, Manager 28. Exactly one Manager per branch.

### Two different branch relationships — do not conflate them

This distinction drives the component split in §9 and recurs throughout the system.

| | **Customer home branch** | **User default branch** |
|---|---|---|
| Column | `customer.home_branch_id` | `app_user.default_branch_id` |
| Means | **Ownership.** The home-branch manager owns the account — special prices, credit limit, relationship. | **Location.** Where this member of staff physically is. John Smith signs in at the counter and is set to Liverpool. |
| Changes | Rarely — an attribute of the customer | Per shift — session context |
| Cardinality | One owner | One default, but potentially **many permitted** — a sales desk rep covering Liverpool and Manchester |
| Exceptions | A large national account may be owned by head office or a regional large-accounts manager rather than a branch | — |

Two consequences worth recording now:

- **Serving a customer away from their home branch is a business event, not a neutral one.**
  A Warrington plumber turning up in London should raise a flag: the owning branch holds
  the pricing and credit relationship. That check belongs in the customer-facing components
  (find-customer, credit-status) rather than in a branch picker, and needs both facts —
  the working branch and the customer's owning branch — in scope at once.
- **National accounts do not fit the branch-ownership model.** 52 of the 39,087 customers
  are flagged `is_national_account`, and per the ownership rule above they would be owned
  by head office or a regional accounts manager. The schema has no way to express that:
  they still carry an ordinary `home_branch_id`, and there is no head-office branch or
  large-accounts-manager field. Flagged for datagenerator2 (§7.8); not blocking.

---

## 1. Decisions locked

Agreed 2026-08-01:

| # | Decision | Note |
|---|----------|------|
| 1 | **JavaScript only** — plain ESM, no TypeScript | mirrors `datagenerator2` |
| 2 | **Hono** for the API server | mirrors `datagenerator2/ui` and `aph2-access-system` |
| 3 | **Shadow DOM** for every component | true encapsulation → drop-in reuse in host apps |
| 4 | Tailwind is **compiled and adopted per component**, not the Play CDN | required by (3) — see §5 |
| 5 | Stock data is a **`datagenerator2` change**, not a local overlay | see §7 |
| 6 | Indexes + FK enforcement are also a **`datagenerator2` change** | see §7 |
| 7 | `datagenerator.db` is consumed **read-only, in place** | path is configurable |

Consequences of (3) worth stating up front: Tailwind's Play CDN cannot be used, so the
project gains a real Tailwind build step; and the components become genuinely portable —
they can be dropped into any host page without inheriting or leaking CSS.

---

## 2. What the data actually supports

Inspected `/var/home/rcollins/code/datagenerator2/out/datagenerator.db` (111 MB, 22 tables).

| Table | Rows | Feeds |
|---|---:|---|
| `customer` | 39,087 | Find customer, Credit status, Select branch |
| `customer_delivery_address` | 63,623 | Select delivery address |
| `customer_contact` | 60,379 | Find customer (detail panel) |
| `aged_debt` | 1,193,303 | Check credit status |
| `branch` | 28 | Select branch, Multi-branch stock |
| `region` / `area` | 8 / 195 | Branch grouping |
| `product` | 3,714 | Find product, Product detail |
| `product_price` | 15,513 | Product detail (price tiers) |
| `product_group` | 109 | Product detail / search facet |
| `price_break` / `price_break_tier` | 3 / 12 | Product detail (qty breaks) |
| `unit_of_measure` | 26 | Product detail |
| `supplier` | 26 | Find supplier, Product detail |
| `tax_rate`, `tally`, `sales_rep`, `industry_type` | small | lookups |
| **stock** | **absent** | **Stock check, Multi-branch availability — blocked** |

Useful shapes confirmed:

- `customer.credit_status` ∈ `normal` (38,443) / `on_stop` (644); `account_type` ∈
  `cash` (11,854) / `credit` (27,233); `credit_limit_pence` present.
- `aged_debt` spans **2025-08-01 → 2026-07-30** with `unpaid_pence` per invoice — so
  current/30/60/90+ ageing buckets computed against today's date work naturally.
- Invoice volumes are comfortable for a per-customer list: **41.7 invoices per customer on
  average, max 577**; unpaid **7.5 on average, max 100**. `invoice_number` is unique across
  all 1.19M rows, and `purchase_order`, `rep_id`, `order_taking_branch_id` and
  `issuing_branch_id` are fully populated — enough to build a real invoice table view.
- Three shape limits to design around (see §7.5): every row is
  `transaction_type = 'invoice'` / `fulfillment_type = 'ex_stock'` — there are **no credit
  notes and no payment rows** — and `unpaid_pence` is only ever `0` or the full gross
  (`goods_pence + tax_pence`), so **no invoice is part-paid**.
- `product.uom_type` ∈ `unit` (3,631) / `sheet_material` (56) / `tally` (27).
- `product_price` is tiered (`tier` 1..n) and per-UOM — product 1 has 4 tiers in
  `each` plus 2 tiers in a second UOM. The detail component must render a
  price *matrix*, not a single price.
- Money is **integer pence** everywhere; rates/percentages stay decimal.
- `product_group.path` is a materialised path (`Top.Timber.Joinery.Planed`) — breadcrumbs
  and subtree filters come free via `LIKE 'Top.Timber.%'`.

### Measured query cost (current, un-indexed DB)

| Query | Time |
|---|---|
| `customer` name `LIKE` scan (39k rows) | ~1 ms — fine as-is |
| `aged_debt` aggregate for one customer (1.19M rows) | **~38 ms** — `SCAN aged_debt` |
| `aged_debt` unpaid list, date-sorted | **~29 ms** — `SCAN` + `USE TEMP B-TREE FOR ORDER BY` |
| `aged_debt` recent list, date-sorted | **~29 ms** — same |

Only the credit-status path is genuinely slow today, and one composite index fixes all
three of its queries — measured, not estimated, on a scratch copy (§7.2).

---

## 3. Architecture

```
rm-merchant-components/
├─ docs/
│  ├─ plan.md                    ← this file
│  ├─ components/<id>.md         ← per-component spec + changelog
│  └─ upstream-requests.md       ← the datagenerator2 asks (§7), extracted for handover
├─ server/
│  ├─ index.js                   ← Bun entry, serves API + static client
│  ├─ app.js                     ← Hono app, route mounting
│  ├─ db.js                      ← readonly bun:sqlite handle, WAL-aware
│  ├─ routes/
│  │  ├─ customers.js  branches.js  products.js  suppliers.js  stock.js
│  └─ queries/                   ← one SQL module per concern, no ORM
├─ client/
│  ├─ index.html                 ← harness index (component catalogue)
│  ├─ component.html             ← harness component page (one per component, ?id=)
│  ├─ harness/                   ← the dev harness shell (see §6)
│  └─ styles/
│     ├─ tailwind.entry.css      ← @import "tailwindcss" + @theme tokens
│     └─ tailwind.css.js         ← GENERATED CSSResult, adopted by every component
├─ src/components/
│  ├─ registry.js                ← the manifest (§4)
│  └─ <id>/<id>.js               ← one directory per component
├─ scripts/build-css.js          ← Tailwind CLI → shadow-safe CSSResult
├─ test/
└─ package.json
```

### Layering rule

Components never touch SQLite and never hardcode a URL. Each takes an **`api` property**
(an object of async functions) with a default that calls the Hono endpoints via `fetch`.
The harness can swap in a fixture implementation. This is what keeps the two
stock components buildable while upstream work is pending (§7.4), and it is also how
a host application injects its own backend later.

### Server

- `bun:sqlite` opened `{ readonly: true }`, one long-lived handle, prepared statements
  cached per query module.
- DB path resolved in order: `MERCHANT_DB_PATH`, then the `sqlite_path` datagenerator2 is
  configured to write (read from its `datagenerator.env`, so its config change follows
  through here), then `../datagenerator2/out/datagenerator.db`, then a local
  `./data/datagenerator.db`. Fail loudly with a clear message if none exists, listing
  everywhere that was looked. The dataset is consumed in place — copying it into this
  project only creates a second file that goes stale invisibly, so an unused copy in
  `./data` is called out at startup and on the harness index. Startup also reports which
  source won and how old the file is: "I regenerated and nothing changed" is nearly always
  a stale dataset.
- Pence stays pence over the wire; formatting is the component's job.
- Every list endpoint: `q`, `limit` (default 25, max 100), `offset`, and returns
  `{ rows, total, tookMs }`. `tookMs` is displayed in the harness request log.

### API surface

| Method | Path | Component |
|---|---|---|
| GET | `/api/customers?q=&branch=&status=&accountType=` | Find customer |
| GET | `/api/customers/:id` | Find customer (detail) |
| GET | `/api/customers/:id/contacts` | Find customer |
| GET | `/api/customers/:id/delivery-addresses?includeArchived=` | Delivery address |
| GET | `/api/customers/:id/credit` | Credit status (summary + buckets) |
| GET | `/api/customers/:id/invoices?view=unpaid\|recent&sort=&limit=&offset=` | Credit status (invoice list) |
| GET | `/api/branches?region=` | Select branch |
| GET | `/api/products?q=&group=&supplier=&uomType=` | Find product |
| GET | `/api/products/:id` | Product detail |
| GET | `/api/products/:id/stock?branchId=` | Stock check — *blocked* |
| GET | `/api/products/:id/stock/branches` | Multi-branch — *blocked* |
| GET | `/api/suppliers?q=` | Find supplier |
| GET | `/api/harness/scenarios` | Harness fixtures (§6) |

`/api/customers/:id/credit` returns credit limit, total outstanding, ageing buckets
(current / 30 / 60 / 90+), oldest unpaid invoice, computed headroom, and a derived
verdict (`ok` / `near_limit` / `over_limit` / `on_stop`) so the component renders a
decision, not just numbers. `/api/customers/:id/invoices` backs the drill-down list —
kept as a separate endpoint so the summary stays cheap and the list pages independently.
Both are served by the same query module and the same index (§7.2).

---

## 4. Component contract and versioning

Every component is a Lit element that:

1. Extends a shared `MerchantElement` base (adopts the Tailwind stylesheet, sets
   `:host { display: block }`, provides `fmtPence`/`fmtDate` helpers and the `api` property).
2. Declares `static version = "0.1.0"` — **semver, bumped by hand on every behaviour change.**
3. Declares `static harnessSchema` — the props the harness renders controls for
   (name, type, default, options, description).
4. Emits namespaced, composed, bubbling events (`merchant-customer-selected`, etc.)
   carrying a minimal `detail` — the component selects, the host decides.
5. Takes only serialisable inputs. No global state.

`src/components/registry.js` is the single manifest — id, tag, title, version,
one-line description, data dependencies, status (`ready` / `blocked` / `draft`) and
the module path. The index page and the component pages both read it, so adding a
component means adding one entry and one directory.

**Version display:** the harness shows the version as a badge on the catalogue card and
in the component page header. `docs/components/<id>.md` holds the changelog — every bump
gets a dated line saying what changed. Versions start at `0.1.0` and stay `0.x` until a
component has been used in a real host app.

---

## 5. Tailwind under Shadow DOM

Shadow DOM blocks the document stylesheet, so:

1. `scripts/build-css.js` runs `@tailwindcss/cli` over `src/styles/tailwind.entry.css`
   with `source(none)` plus explicit `@source` globs covering `src/components/**/*.js`
   and `client/**/*.{js,html}` — automatic detection would find neither from that path.
2. **Tailwind v4.3 already emits `:root, :host` for theme variables and `html, :host` for
   preflight**, so the `:root` → `:host` rewrite this plan originally assumed turned out to
   be unnecessary. `hostify()` remains as an idempotent guard: if a future version emits a
   `:root`-only rule, theme variables would silently vanish inside every shadow root, and
   that is a failure that reads very badly backwards from the symptom.
3. The result is wrapped as `export const tw = unsafeCSS(...)` in
   `src/styles/tailwind.css.js`, imported by `MerchantElement` and shared by every
   component — one `CSSStyleSheet` object, parsed once, adopted many times.
4. The harness pages link the plain CSS artifact for their own light-DOM chrome.

**Dark mode uses `data-theme`, not a class.** A shadow root cannot see `.dark` on `<html>`,
so `@custom-variant dark` matches both `[data-theme="dark"] *` (harness chrome) and
`:host([data-theme="dark"]) *` (inside the component). The harness sets the attribute on
`<html>` and on the component element, which is the shadow host.

Scripts: `bun run css` (once) and `bun run css:watch` (dev). `bun run dev` runs
`--hot` server + CSS watch together.

**Theming for host apps:** components expose `::part()` on their outer regions and
read a small set of CSS custom properties (`--merchant-accent`, `--merchant-radius`,
`--merchant-font`), so a host can restyle without piercing the shadow root.

---

## 6. The harness

**Index page (`/`)** — a card per component from the registry: title, version badge,
one-line description, status chip, data dependencies. Blocked components are visibly
marked with the reason.

**Flow pages (`/f/<id>`)** — several components run as a sequence, wired by their events.
The component page tests one component thoroughly and tests the joins between them not at
all, which is where this project has come closest to shipping something wrong: `isHome` vs
`isDefault` vs `isCustomerHome` was a collision only visible with two components in the same
room. Each step declares what it consumes; a step whose input has not arrived says what it is
waiting for rather than rendering broken. The detail that flowed between steps is shown, not
hidden — it is the contract under test.

Flow pages also carry the **cross-component checks that no single component can make**,
because each holds half the facts: serving a customer owned by another branch (§0), an
on-stop or over-limit verdict reached after the customer was chosen, a cash account with a
delivery address. `client/harness/flows.js` holds both the wiring and those rules.

**Component page (`/c/<id>`)** — the actual development surface:

- **Stage** — the live component, on a resizable frame with 360 / 768 / 1280 / fluid presets
  and a light/dark toggle, so responsive behaviour is tested rather than assumed.
- **Props panel** — controls generated from `static harnessSchema`; edits apply live.
- **Scenario picker** — named fixtures resolved to *real* rows from the DB via
  `/api/harness/scenarios`, e.g. "customer on stop" (one of the 644), "customer over
  credit limit", "customer with 40+ delivery addresses", "product with multi-UOM price
  tiers", "tally product", "sheet-material product". Without this, edge cases are found
  by luck. Scenarios are resolved by query at startup, not hardcoded ids, so they
  survive a regenerated database.
- **Event log** — every event the component emits, with timestamp and pretty `detail`.
  This is the contract a host app consumes, so it needs to be visible.
- **Request log** — each API call with URL, status, `tookMs` and row count. Makes the
  39 ms credit query (and its fix) obvious.
- **State/DOM inspector** — current reactive properties, plus a copyable snippet of the
  markup needed to embed the component with its current settings.

The harness lives entirely in `client/harness/` and is not shipped with the components.

---

## 7. Upstream: `datagenerator2` changes

Per the decisions in §1, these land in `datagenerator2` (schema source of truth is
`src/db/schema.js`, naming rules in `docs/NAMING.md`). Extracted into
`docs/upstream-requests.md` for handover.

### 7.1 New `stock` table

Nothing in the current schema links product to branch. Proposed, following `NAMING.md`
(singular name, `_id` FKs, `is_` booleans, integer pence, decimal quantities):

| Column | Type | Note |
|---|---|---|
| `id` | id | |
| `product_id` | int | FK `product` |
| `branch_id` | int | FK `branch` |
| `last_cost_pence` / `weighted_average_cost_pence` | money | **cost is per branch** — branch 5 buys girders well, my branch does not. See upstream-requests §3 |
| `replenish_method` | text | `supplier` / `supplier_direct` / `ibt` / `made_to_order` / `not_stocked` — per branch, since the specialist branch buys what the others transfer in |
| `source_branch_id` / `supplier_location_id` / `lead_time_days` | int | who supplies this branch, and how long it takes. Decides whether zero on hand means "out of stock" or "made to order, 5 days" |
| ~~`is_stocked_item`~~ | — | **moved** to `product_branch.status` (`non_stock` = obtainable but not held). Ranging is a merchandising decision, stock is inventory state; splitting them unblocks `find-product` ahead of this table. See upstream-requests §2d |
| `on_hand_qty` | decimal | |
| `allocated_qty` | decimal | free = on_hand − allocated |
| `on_order_qty` | decimal | |
| `on_order_eta` | date | nullable |
| `min_qty` / `max_qty` / `reorder_qty` | decimal | reorder policy |
| `bin_location` | text | e.g. `YARD-B12` |
| `last_counted_at` | date | |
| `updated_at` | date | |

Unique on `(product_id, branch_id)`. Full cross-product is 3,714 × 28 = 103,992 rows;
realistic generation stocks a subset per branch (weighted by product group and branch
size), landing around 30–50k rows.

Three points worth deciding while generating it:

- **Tally products (27 of them)** carry per-length tallies (`tally.tally` =
  `"2.4,3,3.6,4.2,4.8"`). Genuine merchant stock for these is a quantity *per length*,
  not one number. Either a `stock_tally_line` child table, or accept a single aggregate
  quantity for now and note the simplification. **Recommendation:** aggregate now, child
  table later — the two stock components should not wait on it.
- **Sheet material (56)** should hold quantities consistent with `pack_coverage_m2` /
  `qty_per_pallet` so multi-branch totals look plausible.
- **Realism knobs** that make the components worth testing: some products out of stock
  everywhere, some at one branch only, some negative-free (allocated > on hand), some
  below reorder level. Flat random data will make every component look the same.

Optional, not required for these components: a `stock_movement` history table.

### 7.2 Indexes

The shipped DB has **no explicit indexes**. (It has two implicit `sqlite_autoindex` entries
from the `UNIQUE` constraints on `supplier.code` and `product.code`, so lookups by those two
codes are already covered — everything else scans.) Minimum set for this project:

```
aged_debt (customer_id, transaction_date)       -- MEASURED: see below
customer (name), customer (account_code), customer (postcode)
customer (home_branch_id)
customer_contact (customer_id)
customer_delivery_address (customer_id)
product (name), product (product_group_id), product (default_supplier_id)
product_price (product_id)
branch (region_id)
stock (product_id, branch_id) UNIQUE, stock (branch_id)
```

**The `aged_debt` composite is proven, not proposed.** Benchmarked on a scratch copy
(5-run mean, `bun:sqlite`):

| Credit-status query | Before | After | Plan after |
|---|---:|---:|---|
| Ageing-bucket aggregate | 37.83 ms | **0.01 ms** | `SEARCH ... USING INDEX (customer_id=?)` |
| Unpaid list, date-sorted | 28.65 ms | **0.04 ms** | same — temp B-tree gone |
| Recent list, date-sorted | 29.22 ms | **0.02 ms** | same — temp B-tree gone |

One index covers all three. `(customer_id, transaction_date)` rather than
`(customer_id)` alone because the trailing column also satisfies `ORDER BY
transaction_date DESC`, removing the `USE TEMP B-TREE FOR ORDER BY` on both list views.
Build cost **260 ms**; file size unchanged at 106.4 MB (it fits in existing free pages).
A single `aged_debt(customer_id)` index would fix the aggregate but leave both lists
sorting in a temp B-tree, so skip it.

Optionally an FTS5 index over `customer(name, account_code, town, postcode)` and
`product(code, name)` for typo-tolerant search. Not needed at current row counts —
`LIKE` on 39k customers measures 1 ms — so this is a "later, if search gets richer" item.

### 7.3 Foreign keys

`pragma foreign_key_list(customer)` returns empty — no FKs are declared. Declaring them
(and enabling `PRAGMA foreign_keys=ON`) makes the dataset self-documenting and lets this
project's queries be checked against real constraints. Note `product.tally_id` uses `0`
as "none" rather than `NULL`, which will need normalising before an FK can be added.

### 7.4 The cross-project loop

The working pattern is: build a component here, find a slow query, add the index in
`datagenerator2`, regenerate, come back. Two things make that loop cheap enough to stay in.

**Measure before you flip.** `bun run explain <name>` (or `--sql "…"`) runs a query against
a **scratch copy** of the DB, optionally applying `--index` candidates first, and prints
before/after timings and `EXPLAIN QUERY PLAN` — exactly the table above. The scratch copy
means candidates are tried in seconds without touching `datagenerator.db` or regenerating
anything, and it is deleted on exit. Only proven indexes get promoted upstream, so a
regeneration cycle is never spent on a guess.

**See it live.** The harness request log (§6) shows `tookMs` and the query plan for every
API call, with a warning marker on plans containing `SCAN` or `TEMP B-TREE`.

That marker is gated on time (`MERCHANT_WARN_MS`, default 5 ms), which matters more than it
sounds: `branches.list` scans and sorts in a temp B-tree, and at 28 rows / 0.3 ms it wants
no index at all. Warning on the plan alone would fire on almost every query in the project
and train us to ignore it. The plan is always shown; only the warning is conditional.

Proven indexes are recorded in `docs/upstream-requests.md` with their measurements, so the
datagenerator2 side is a copy-paste of `create index` statements into `src/db/schema.js`
rather than a re-derivation. The server tolerates their absence — nothing breaks without
them, it is only slower — so the two projects never have to be in lockstep.

### 7.5 Credit-status data realism (optional, upstream)

Not blocking — the component works with today's data — but these limits mean some states
can never be exercised, so they are worth knowing when generating the next dataset:

- **No credit notes or payments.** All 1,193,303 rows are `transaction_type='invoice'`.
  A real ledger has credit notes and payments on account, which change what "outstanding"
  means and are the usual source of negative balances.
- **No part-paid invoices.** `unpaid_pence` is either `0` or the full gross. A part-payment
  column in the UI would be dead code against this data.
- **Every customer is `active`** and every product is `active`, so archived/suspended
  rendering paths are untestable.
- 644 customers are `on_stop`, which is enough to exercise that path — good.

The component will be built to handle credit notes and part-payments correctly regardless,
since those are cheap to support up front and expensive to retrofit.

### 7.6 Working while blocked

The two stock components are **not** deferred. They are built against the API contract in
§3 with a `fixtureStock` provider generating plausible responses in-memory. When the
upstream table lands, `server/routes/stock.js` switches from fixture to SQL and the
components are unchanged — the fixture stays as a harness scenario source. If the
upstream shape ends up differing from §7.1, the change is confined to one query module.

---

### 7.7 Permissions: user × branch × permission

Agreed 2026-08-01 from the permission matrix. Lands in datagenerator2 per decision #6.
This is the design the sign-in payload and every staff component are built against.

#### The distinction that shapes it

`app_role` holds **job functions** — Sales, Counter, Purchasing and stock, Manager. The
matrix holds **permissions** — `sales_enquiries`, `goods_inward`, `raise_ibt`. These are
different kinds of thing and must not be merged into one table: a person's job title and
the specific privileges they hold vary independently, and the matrix already shows it —
user 1 holds the full set at branch 1 but only `sales_enquiries` at branches 2–4.

#### Tables

**Implementation spec: [`docs/requirements-permissions.md`](requirements-permissions.md)** —
full DDL, seed data, generation rules and verification queries, written to be worked from
in datagenerator2. This section is the design and the reasoning behind it.

```sql
-- Job functions. `code` is what application logic keys on; `approval_rank` orders the
-- escalation chain (NULL = not an approver, 1 Manager, 2 Regional, 3 Head office).
CREATE TABLE app_role (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, role TEXT NOT NULL,
  approval_rank INTEGER
);

-- The catalogue. Adding a permission is an INSERT, never a schema change.
CREATE TABLE permission (
  id            INTEGER PRIMARY KEY,   -- sparse and grouped: 1–8 sales, 51–56 stock, 90–91 works orders
  code          TEXT NOT NULL UNIQUE,  -- sales_enquiries
  name          TEXT NOT NULL,
  description   TEXT,                  -- the "notes" column of the matrix
  category      TEXT NOT NULL,         -- sales | pricing | credit | purchasing | stock | works_order
  scope         TEXT NOT NULL,         -- working_branch | any_permitted_branch | global
  is_limited    INTEGER NOT NULL,      -- whether an approval threshold applies to this permission
  sort          INTEGER
);

-- Which branches a user works at, and in what job function at each.
-- Supersedes the thinner app_user_branch previously sketched here.
CREATE TABLE app_user_branch (
  id            INTEGER PRIMARY KEY,
  app_user_id   INTEGER NOT NULL,
  branch_id     INTEGER NOT NULL,
  app_role_id   INTEGER NOT NULL,      -- role may differ per branch
  is_default    INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_app_user_branch ON app_user_branch(app_user_id, branch_id);

-- The grants. One row per permission the user actually holds at that branch.
CREATE TABLE app_user_permission (
  id                   INTEGER PRIMARY KEY,
  app_user_id          INTEGER NOT NULL,
  branch_id            INTEGER NOT NULL,
  permission_id        INTEGER NOT NULL,
  approval_limit_pence INTEGER   -- NULL = no value threshold, never routes for approval
);
CREATE UNIQUE INDEX ux_app_user_permission
  ON app_user_permission(app_user_id, branch_id, permission_id);
CREATE INDEX ix_app_user_permission_branch
  ON app_user_permission(branch_id, permission_id);
```

#### What the matrix's two columns mean

**Y/N is granted / not granted.** `raise_purchase_order` = `Y` means the user may raise
purchase orders. `raise_purchase_order_any_supplier` = `N` means they may not — so they can
only order from the product's default supplier.

**The limit is an auto-approval threshold on a granted permission**, not a hard ceiling.
`raise_purchase_order` `Y` with 1500 means: raise it freely up to £1500 ex-VAT; above that
the PO is routed to the branch manager for approval. The action is never simply refused.

**A limit on an `N` row is meaningless and must be ignored** — those are leftover template
values in the spreadsheet. `raise_purchase_order_any_supplier` `N` with 100 is not "may
order from any supplier up to £100"; it is "may not order from any supplier", full stop.
Generation must not carry those numbers across.

Consequences for the schema:

- **Absence of a row means not granted.** Only granted permissions are stored, so `N` cells
  produce no row at all. With no role-level inheritance to override (see below), an
  explicit denial and an absence are indistinguishable in effect, so there is no
  `is_granted` column to carry.
- **`approval_limit_pence` is NULL for permissions with no threshold** — `override_selling_prices`
  is granted with no value limit because its constraint is the margin band, not a value.
  NULL means "never routes", not "always routes".
- **The boundary is exclusive**: value > limit routes for approval; value ≤ limit proceeds.
- **Money follows rule 6** — integer pence, so the matrix's `1500` is `150000`, ex-VAT.

Applying this to the sample row, user 1 at branch 1 is granted `sales_enquiries`,
`sales_counter` (£500), `sales_desk` (£1000), `override_selling_prices`,
`raise_credit_note` (£250), `raise_purchase_order` (£1500), `goods_inward`, `stock_take`
and `raise_sales_works_order` — nine rows, not fifteen.

#### No role_permission table (decided)

Permissions are held per user, not defaulted from the role. The administrative burden of
setting ~15 permissions per new starter is handled in the UI by **copy profile from
another user**, not in the schema.

The trade-off, recorded so it is a known cost rather than a surprise: a copy is a
*snapshot*. A policy change — "all counter staff go to £750" — means editing every
affected user, where role defaults would be one edit. If that becomes painful, add
`role_permission` purely as a **template source**, so the admin UI can offer "copy from
role" alongside "copy from user". Grants stay per-user either way, so this can be added
later without touching existing data.

#### Approval routing and the escalation chain

Over-limit requests go to **the branch manager** — the data supports this directly, with
exactly 28 Managers for 28 branches. Two further roles complete the chain so that it always
terminates:

| `approval_rank` | Role | Covers |
|---:|---|---|
| — | Sales, Counter, Purchasing and stock | their own branches; not approvers |
| 1 | Manager | one branch |
| 2 | Regional manager | every branch in one of the 8 regions |
| 3 | Head office | every trading branch, with no limits at all |

Escalation goes to the **lowest-ranked approver above the raiser** who covers the branch,
holds the permission, and has the headroom. Head office holding NULL limits is what
guarantees a £500,000 purchase order always has somewhere to go — otherwise an over-limit
request can reach the top of the chain and stick, which is the failure mode this table
exists to prevent.

Approval capability is deliberately **not** a separate `approve_*` permission: an approver
is someone holding the same permission with a higher threshold. One concept, not two.

Coverage is **enumerated** rather than implied — a regional manager gets a row per branch in
their region, head office a row per branch. At 28 branches that is ~370 rows total, and it
buys a single query shape at every level rather than a special case for "covers a region".

The routing query is the one that argues hardest against storing grants as JSON:

```sql
-- Who can approve permission :p at branch :b for an ex-VAT value of :v pence?
-- The approver must hold the permission themselves and have the headroom for it.
SELECT u.id, u.given_name, u.surname
  FROM app_user_branch ub
  JOIN app_role r  ON r.id = ub.app_role_id
  JOIN app_user u  ON u.id = ub.app_user_id
  JOIN app_user_permission p
    ON p.app_user_id = u.id AND p.branch_id = ub.branch_id
 WHERE ub.branch_id = :b
   AND r.approval_rank IS NOT NULL
   AND r.approval_rank > :raiser_rank        -- 0 when the raiser has no rank
   AND p.permission_id = :p
   AND (p.approval_limit_pence IS NULL OR p.approval_limit_pence >= :v)
 ORDER BY r.approval_rank
 LIMIT 1;
```

A join against indexed columns relationally; a full scan with JSON extraction otherwise.

#### On JSON

**Not for the catalogue or the grants.** A lookup table is already zero-schema-change to
extend — a new permission is an `INSERT`. JSON would add nothing there while costing FK
integrity, indexes, and the routing query above.

**Reasonable for sparse per-permission parameters**: a `constraints` JSON column on
`app_user_permission` for things that only apply to some permissions —
`max_margin_pct` for price override, `supplier_ids` for restricted POs. That matches the
existing `user_defined` / `specification` columns. `approval_limit_pence` is universal enough to
stay a typed column.

#### Permission catalogue (seed)

Codes normalised from the matrix — typos corrected, and the `can_` prefix dropped from 90
and 91 since every permission is a "can". `is_limited` says whether an approval threshold
is meaningful for that permission at all; the Y/N and limit columns are the *sample row*
for user 1 at branch 1, not properties of the permission.

| id | code | category | `is_limited` | sample: granted | sample limit |
|---:|---|---|---|---|---:|
| 1 | `sales_enquiries` | sales | no | yes | — |
| 2 | `sales_counter` | sales | yes | yes | 500 |
| 3 | `sales_desk` | sales | yes | yes | 1000 |
| 4 | `override_selling_prices` | pricing | no | yes | — |
| 6 | `override_selling_prices_any` | pricing | no | **no** | ignore |
| 7 | `raise_credit_note` | credit | yes | yes | 250 |
| 8 | `raise_cash_credit_note` | credit | yes | **no** | ignore |
| 51 | `raise_purchase_order` | purchasing | yes | yes | 1500 |
| 52 | `raise_purchase_order_any_supplier` | purchasing | no | **no** | ignore |
| 53 | `goods_inward` | stock | no | yes | — |
| 54 | `stock_take` | stock | no | yes | — |
| 55 | `stock_adjustment` | stock | no | **no** | ignore |
| 56 | `raise_ibt` | stock | no | **no** | ignore |
| 90 | `raise_sales_works_order` | works_order | no | yes | — |
| 91 | `raise_stock_works_order` | works_order | no | **no** | ignore |

`52` is marked not-limited because it is a capability switch — you may or may not order
from non-default suppliers — with the *value* threshold living on `51`. Same reasoning for
`6` against `4`.

#### Sign-in payload

```jsonc
{
  "user":     { "id": 1, "name": "Robert Collins", "defaultBranchId": 1 },
  "branches": [ { "id": 1, "code": "01", "name": "Chester", "role": "Manager" } ],
  "permissions": {
    "1": {                                    // keyed by branch id
      "sales_enquiries":      {},             // held, no value threshold
      "raise_purchase_order": { "approvalLimitPence": 150000 }
    }
  }
}
```

A key present means the permission is held. `raise_purchase_order_any_supplier` is simply
absent, so the UI offers only the default supplier. Where `approvalLimitPence` is present,
the UI can warn *before* submission that the value will route for approval, rather than
letting someone fill in a PO and discover it afterwards.

Keyed by branch because that is how it varies. **The client uses this for affordances
only** — greying out a button, showing a limit — and the server re-checks on every write.
Same rule as `allowedCodes` on `working-branch`: anything the browser holds is display,
not authorisation.

When this lands, `listBranchesForUser()` in `server/queries/branches.js` joins
`app_user_branch` and `allowedCodes` stops being load-bearing. That function is the single
seam; no component changes.

#### Open points

- **Overlapping thresholds.** User 1 holds both `sales_counter` (£500) and `sales_desk`
  (£1000). For a £750 counter sale, which applies? If the three `sales_*` permissions are
  tiers — desk ⊃ counter ⊃ enquiries, which the notes suggest — the answer is "the highest
  tier held", and they may be better modelled as one tiered value than three grants. If
  they are genuinely independent, the evaluation rule needs stating.
- **Permission id 5 is absent** from the matrix (1,2,3,4,6,7,8) — deliberate gap or
  omission?
- **`scope` per permission** is proposed because the matrix says "Working branch only" on
  `sales_counter` and not on the others, implying it varies. Each permission needs its
  scope assigned.

Assumed unless corrected: thresholds are per document (a whole PO or sales order), ex-VAT,
and an over-limit action is created in a pending-approval state rather than refused.

### 7.8 National-account ownership

See §0: 52 customers are `is_national_account` but the schema can only express branch
ownership. Options are a nullable `customer.owning_sales_rep_id`, a head-office
pseudo-branch, or an explicit `customer.ownership_type` enum (`branch` / `regional` /
`head_office`). Worth deciding before credit-status renders "owned by", because that
component states who holds the credit relationship.

### 7.9 Customer search: indexes and FTS

Detail and DDL in [`requirements-customer-search.md`](requirements-customer-search.md) §3.
Two findings worth keeping here because both contradict what this plan said earlier.

**`COLLATE NOCASE` is load-bearing.** `LIKE` is case-insensitive by default, so SQLite can
only use an index to serve a prefix `LIKE` when the index carries that collation. A plain
`customer(postcode)` index — which §7.2 originally asked for — leaves the plan on `SCAN` and
saves nothing measurable. With `NOCASE`, `postcode LIKE 'SK4%'` goes 0.77 ms → **0.02 ms**
and `account_code LIKE 'CA/00272%'` 2.22 ms → **0.01 ms**.

**The unfiltered-scan cost was overstated.** This plan quoted 23.7 ms for an unanchored name
search. That was a cold one-shot reading — first-touch I/O against a 100 MB file, paid once —
not steady state. Warm, at 39k rows, the worst case is ~2.9 ms, and the worst case is a term
matching *nothing* rather than a common one, because `LIMIT 25` lets a popular term exit
early.

That correction changes the FTS argument. At 39k rows FTS is unnecessary. At ~394k rows the
same scan is 25.3 ms, and branch filtering only reaches 9.1 ms, while trigram FTS stays at
0.01 ms at both sizes. So FTS is justified by the customer count being configurable and real
merchants holding hundreds of thousands of accounts — not by anything measurable today. It
is worth doing while the schema is open rather than retrofitted later.

## 8. Build order

Each phase ends with something runnable.

**Phase 0 — Skeleton, proven by the branch picker. ✅ Complete 2026-08-01.**
`package.json` (deps: `hono`, `lit`; dev: `@tailwindcss/cli`), Hono server, readonly DB
handle with path config, Tailwind build script, `MerchantElement` base, registry, harness
index + component page — and **Select branch `v0.1.0`** as the vehicle that proves it end
to end.

Verified in headless Chrome against the real dataset: shadow root present with 3 adopted
stylesheets; Tailwind utilities applying inside it (`p-3` → 12px, `rounded-merchant` → 8px
via the custom theme token); 28 branch buttons in 8 region groups; click emitting
`merchant-branch-selected` with the right detail across the shadow boundary; the dark
variant flipping `bg-white` to slate-900 *inside* the shadow root; and a host-set
`--merchant-accent` reaching in and changing the selected border. No console errors.

The branch picker is the right stack proof precisely because it is the least demanding
component: 28 branches across 8 regions means no paging, no debounce, no async race and no
domain arithmetic, so anything that breaks in Phase 0 is a stack fault rather than a
component fault. It still exercises the whole vertical — Hono route → `bun:sqlite` →
`fetch` → Lit render, the Tailwind build and per-component stylesheet adoption, `::part()`
theming and dark mode, the registry entry, the harness props panel and event log, and the
version badge — and region-grouped cards give enough layout and typography to expose a
broken CSS pipeline immediately. Unlike a placeholder it is also a keeper: component 4,
shipped, not scaffolding.

What it does *not* prove — debounced search, loading states, paged lists — is why credit
status follows immediately in Phase 1.

**Phase 1 — Customer group.** Find customer → **Check credit status** → Select delivery
address → Select branch `v0.2.0` (home-branch pinning, once a customer exists to pin it
against). They chain, and the harness passes a selected
customer from one to the next. Credit status moves ahead of the address components
because it is the deepest of the four — summary plus paged invoice list, ageing logic,
verdict rules, and the only real query-performance work — so it shapes the shared
result-list and money-formatting patterns the rest inherit. It is also the natural first
exercise of the §7.4 measure-then-flip loop.

**Phase 2 — Product group.** Find product(s) → Show product details → Find supplier.
Product detail is the heaviest read (prices × UOM × breaks × group path × tax × supplier)
and worth building before search so search knows what it links to.

**Phase 3 — Stock group.** Stock check → Multi-branch availability, against the fixture
provider, swapping to SQL when §7.1 lands.

**Phase 4 — Polish.** Keyboard navigation and ARIA (these are search/select widgets —
type-ahead, arrow keys, `role="listbox"`, announced result counts), loading/empty/error
states, `docs/components/*.md`, `bun test` coverage of the query modules and of each
component's event contract.

Open items 7.1's tally decision and the FTS5 question are the only things that could
change scope, and neither blocks Phase 0–2.

---

## 9. The components

Each entry: what it does · key data · what it emits.

1. **Find customer** `v0.1.0` — one text box at the trade counter, routed by what is typed.
   Requires `branch_quick_code` and `branch_neighbour`
   ([`requirements-customer-search.md`](requirements-customer-search.md)).

   | Input | Route |
   |---|---|
   | a single digit `1`–`9` | that branch's quick code → one cash account, immediately |
   | matches the dataset's account-code shape | account code prefix |
   | 4+ characters starting letter(s) then a digit | postcode, then name |
   | 4+ characters otherwise | name |

   **The account-code shape is derived from the data, never hardcoded.** datagenerator2
   emits one of four formats from `account_code_format`, and they do not share a pattern:
   `9999999` (1), `XX/999999` (2), `XX/9999999` (3, current), `XXX/999999` (4). A rule keyed
   on "two letters then a slash" silently stops matching under format 4 and matches nothing
   at all under format 1, which has neither letters nor a slash — and under format 1 a
   numeric term is an account code rather than a name.

   So **routing happens server-side**, against a shape inferred from sampled `account_code`
   values at startup: all-digits of length *n*, or *k* letters then `/` then *n* digits.
   Inference beats reading a recorded setting here, because a long-lived dataset can hold
   more than one format after a change of convention, and matching both patterns at once is
   then the correct behaviour rather than an error. The component posts the raw term and
   gets back rows plus the route that matched; it never needs to know the format.

   Single-digit input stays a quick code under every format — the numeric format is seven
   digits, so length disambiguates.

   Scoped to the **working branch** by default. That is the business rule, and it also keeps
   the query cheap, though less dramatically than an earlier draft of this plan claimed —
   see §7.9. **National accounts are always included** regardless of branch: 53 customers
   across 20 branches, and per §0 they are not really branch-owned at all.

   A **widen** control adds the branches in `branch_neighbour`, then all branches on a
   second press. Each result says which branch owns it, and widened results are marked as
   coming from outside the working branch — a Chester counter needs to see at a glance that
   this customer is on Bangor's books. Widening matters most where the region map helps
   least: Newtown holds 91 customers and Bangor 244, against Stockport's 3,635.

   Rows carry account code, name, town, postcode, owning branch, `cash`/`credit`, and an
   `on stop` flag — 613 customers are on stop, and releasing goods to one is the mistake the
   flag exists to prevent. · `customer`, `branch_quick_code`, `branch_neighbour`, `branch` ·
   `merchant-customer-selected { id, accountCode, name, accountType, isNationalAccount,
   homeBranchId, matchedOn }`.

   `matchedOn` (`quick_code` / `account_code` / `postcode` / `name`) travels with the
   selection because the order flow behaves differently after a quick code — that is a
   counter cash sale, already decided — than after a name search.

2. **Select delivery address for customer** `v0.1.0` — addresses for a customer, archived
   hidden by default, showing project reference, unload method, delivery instructions,
   what3words / plus code. Handles the customer with 40+ addresses without becoming a wall
   of text. · `customer_delivery_address` ·
   `merchant-delivery-address-selected { id, customerId }`.

3. **Check credit status for customer** `v0.1.0` — two tiers in one component:
   a **summary** (limit, outstanding, headroom, ageing buckets current/30/60/90+ as a bar,
   oldest unpaid invoice, verdict badge; cash accounts and `on_stop` render distinctly), and
   a **drill-down invoice list** — unpaid and recent views over `aged_debt` showing invoice
   number, date, PO, goods, tax, gross, unpaid and issuing branch, sortable by date or
   value, age-banded, paged (avg 42 invoices per customer, max 577). Clicking a bucket in
   the summary filters the list to that band. The two tiers load from separate endpoints so
   the summary paints immediately. · `customer`, `aged_debt`, `branch` ·
   `merchant-credit-checked { customerId, verdict, headroomPence }`,
   `merchant-invoice-selected { invoiceNumber, customerId }`.

4. **Select branch** `v0.2.0` — *which branch for this piece of work*: order-taking branch,
   issuing branch, transfer destination. All 28 branches grouped by their 8 regions as a
   card grid with code, name, address and telephone, optionally narrowed by `allowedCodes`.
   Unknown codes are reported rather than silently dropped, because a typo in an access list
   otherwise looks like a permissions problem. `v0.3.0` (Phase 1) takes a `customerId` and
   pins the customer's **owning** branch. · `branch`, `region`, `customer.home_branch_id` ·
   `merchant-branch-selected { id, code, name, isCustomerHome }`.

4b. **Working branch** `v0.1.0` — *where is this member of staff operating from*. A compact
   native `<select>`, grouped into optgroups when more than one region is in range,
   preselected to the user's `app_user.default_branch_id` (the sign-in behaviour) and
   restricted to the branches they may cover. Shows who is signed in and their role, and
   flags when they are working away from their default. · `app_user`, `app_role`, `branch`,
   `region` · `merchant-working-branch-changed { id, code, name, isDefault, userId, cause }`.

   **Why these are two components, not one with a `format` property.** They answer
   different questions (§0): purpose versus location. They read different tables, take
   different defaults, and have different a11y models — a grid of buttons versus a native
   select. `dense` and `showContact` are meaningless in a dropdown. And per-component
   versioning means a card-layout tweak would otherwise bump the version for dropdown
   consumers. They share a non-visual core (`shared/branches.js`) so the row shaping cannot
   drift, and a host can swap one for the other by listening for the other event.

   `cause` distinguishes the component preselecting on load (`"default"`) from a person
   actively choosing (`"user"`) — a host persisting working context needs to tell those
   apart. Auto-selection only fires when the default branch is actually in the permitted
   list, so a rep whose default was revoked is not silently placed there.

5. **Find product(s)** `v0.1.0` *(built)* — one box taking a code, a name or a scanned
   barcode, searched against **what this branch ranges** rather than the whole catalogue.
   Every result carries one of five availability states — in range, to order, other branches,
   special order, not permitted — because a hit that does not say which invites someone to
   promise stock the yard has never carried. `not_permitted` is shown greyed and refuses
   selection rather than being hidden. Faceted by product-group subtree (`path LIKE`);
   supplier and UOM facets deferred. Price always shown with its unit, since 266 products
   change unit between tiers. · `product`, `product_branch`, `product_group`, `supplier`,
   `product_price`, `unit_of_measure` ·
   `merchant-product-selected { product, availability, branchId, scope }`.

6. **Show details for product** `v0.1.0` — full card: identity and barcodes, group
   breadcrumb from the materialised path, dimensions/weight, pack quantities, the price
   tier matrix per UOM with quantity breaks, tax rate, default supplier, margins. · `product`,
   `product_price`, `price_break(_tier)`, `unit_of_measure`, `tax_rate`, `product_group`,
   `supplier` · `merchant-product-price-selected { productId, tier, uomId, pricePence }`.

7. **Stock check for product** `v0.1.0` *(blocked → fixture)* — for one product at one
   branch: on hand, allocated, free, on order with ETA, bin location, reorder levels,
   with a clear out-of-stock / below-minimum state. · `stock` (§7.1) ·
   `merchant-stock-checked { productId, branchId, freeQty }`.

8. **Multi-branch stock availability** `v0.1.0` *(blocked → fixture)* — the same product
   across all 28 branches, grouped by region, sorted by free quantity, with a network total
   and "nearest with stock" highlighting. · `stock`, `branch`, `region` ·
   `merchant-branch-stock-selected { productId, branchId }`.

9. **Find supplier** `v0.1.0` — search over 26 suppliers by code / name / town, showing
   contact details, VAT number, status, and a count of products they supply by default. ·
   `supplier`, `product.default_supplier_id` ·
   `merchant-supplier-selected { id, code, name }`.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| ~~Tailwind-in-shadow-DOM is the one unproven piece~~ | **Closed.** Proven in Phase 0 on the branch picker, verified in a real browser — see §8 |
| Upstream stock schema differs from §7.1 | Fixture provider + one query module absorbs the change |
| Upstream work slips | Phases 1, 2 and 4 have no upstream dependency at all |
| `datagenerator.db` regenerated, ids shift | Scenarios resolve by query, never by hardcoded id |
| Nine components drift in look and behaviour | Shared `MerchantElement` base + one Tailwind build + a shared result-list pattern |
| Credit queries at ~30–38 ms | Index proven in §7.2; `bun run explain` + harness plan warnings catch the next one before it ships |
| Component built against unrealistically clean ledger data | §7.5 — handle credit notes and part-payments up front; they are cheap now, expensive to retrofit |
