# rm-merchant-components — Plan

**Status:** draft for approval · **Date:** 2026-08-01

A component library plus a development harness for builders'-merchant UI components.
Bun + Hono on the server, Lit + Tailwind in the browser, plain JavaScript throughout
(no TypeScript, matching `datagenerator2`). Data comes from the generated
`datagenerator.db`.

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
- DB path from `MERCHANT_DB_PATH`, defaulting to
  `../datagenerator2/out/datagenerator.db`. Fail loudly with a clear message if absent.
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

1. `scripts/build-css.js` runs `@tailwindcss/cli` over `client/styles/tailwind.entry.css`
   with content globs covering `src/components/**/*.js` and `client/**/*.{js,html}`.
2. The output is post-processed: `:root` selectors are rewritten to `:host, :root` so each
   component carries its own theme variables and works standalone in a host page that
   has never heard of Tailwind. (Custom properties *do* inherit through the shadow
   boundary, so a host-provided theme still overrides — the built-in values are a floor,
   not a ceiling.)
3. The result is wrapped as `export const tw = unsafeCSS(...)` in
   `client/styles/tailwind.css.js`, imported by `MerchantElement` and shared by every
   component — one `CSSStyleSheet` object, parsed once, adopted many times.
4. Preflight is scoped to the shadow root rather than `html`/`body`; the harness page
   itself links the same built CSS normally for its own chrome.

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
| `is_stocked_item` | bool | false = obtainable but not held |
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

The shipped DB currently has **zero** indexes. Minimum set for this project:

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

**Measure before you flip.** `bun run explain <name>` runs a named query from
`server/queries/` against a **scratch copy** of the DB, optionally applying candidate
indexes first, and prints before/after timings and `EXPLAIN QUERY PLAN` — exactly the
table above. The scratch copy means candidate indexes are tried in seconds without
touching `datagenerator.db` or regenerating anything. Only proven indexes get promoted
upstream, so a regeneration cycle is never spent on a guess.

**See it live.** The harness request log (§6) shows `tookMs` and the query plan for every
API call, with a warning marker on any plan containing `SCAN` or `TEMP B-TREE`. A missing
index announces itself while you are building the UI rather than in production.

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

## 8. Build order

Each phase ends with something runnable.

**Phase 0 — Skeleton, proven by the branch picker.** `package.json` (deps: `hono`, `lit`;
dev: `@tailwindcss/cli`), Hono server, readonly DB handle with path config, Tailwind build
script, `MerchantElement` base, registry, harness index + component page shells — and
**Select branch `v0.1.0`** as the vehicle that proves it end to end.

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

## 9. The nine components

Each entry: what it does · key data · what it emits.

1. **Find customer** `v0.1.0` — debounced type-ahead over name / account code / postcode /
   town, with branch, status and account-type filters; result rows show account code, name,
   town, home branch, and an `on stop` flag. · `customer` (+`branch`, `sales_rep`) ·
   `merchant-customer-selected { id, accountCode, name }`.

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

4. **Select branch for customer** — built in two versions, and the Phase 0 stack proof.
   `v0.1.0`: all 28 branches grouped by their 8 regions, selectable, each showing code,
   name, address and phone; no customer required. `v0.2.0` (Phase 1): takes a `customerId`
   and pins the customer's home branch at the top, marked, with the rest still selectable. ·
   `branch`, `region`, `customer.home_branch_id` ·
   `merchant-branch-selected { id, code, name, isHome }`.

5. **Find product(s)** `v0.1.0` — search by code / name / barcode, faceted by product-group
   subtree (`path LIKE`), supplier and UOM type; multi-select mode for order building. ·
   `product`, `product_group`, `supplier` ·
   `merchant-products-selected { ids }`.

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
| Tailwind-in-shadow-DOM is the one unproven piece | Phase 0 proves it on the branch picker — the component with the least of its own complexity, so failures are unambiguously stack failures |
| Upstream stock schema differs from §7.1 | Fixture provider + one query module absorbs the change |
| Upstream work slips | Phases 1, 2 and 4 have no upstream dependency at all |
| `datagenerator.db` regenerated, ids shift | Scenarios resolve by query, never by hardcoded id |
| Nine components drift in look and behaviour | Shared `MerchantElement` base + one Tailwind build + a shared result-list pattern |
| Credit queries at ~30–38 ms | Index proven in §7.2; `bun run explain` + harness plan warnings catch the next one before it ships |
| Component built against unrealistically clean ledger data | §7.5 — handle credit notes and part-payments up front; they are cheap now, expensive to retrofit |
