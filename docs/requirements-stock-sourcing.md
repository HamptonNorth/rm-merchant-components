# Requirement: stock, sourcing and inter-branch supply

**For:** `datagenerator2` · **Raised by:** rm-merchant-components · **Date:** 2026-08-04

Split out of `upstream-requests.md` §3, which grew from "add a stock table" into the whole
sourcing model as the questions were worked through.

Everything here hangs off one observation: **a product is not one thing company-wide.** Its
cost, its stock, how it is replenished and who supplies it all vary by branch, and the
schema currently holds each of them once per product.

| Fact | Held today | Should be |
|---|---|---|
| stock on hand | nowhere | per `(product, branch)` |
| last / average cost | per product | per `(product, branch)` |
| how it is replenished | nowhere | per `(product, branch)` |
| who supplies it | one FK per product | many, ordered by preference |
| which depot it ships from | nowhere | per supplier, with a branch default |

**Status:** blocking `stock-check` and `multi-branch-stock`. The sourcing half is not
blocking anything yet, but it decides what the stock components are able to say.

---

## Stock — [plan §7.1](plan.md)

**Status:** blocking two components (`stock-check`, `multi-branch-stock`), which are built
against a fixture provider until this lands.

No table links product to branch. Proposed `stock`: `product_id`, `branch_id`,
`on_hand_qty`, `allocated_qty`, `on_order_qty`, `on_order_eta`,
`min_qty`, `max_qty`, `reorder_qty`, `bin_location`, `last_counted_at`, `updated_at`,
**`last_cost_pence`, `weighted_average_cost_pence`**;
unique on `(product_id, branch_id)`. Roughly 30–50k rows if branches stock a realistic
subset of the 3,714 products rather than the full 103,992 cross-product.

> **`is_stocked_item` has moved** to `product_branch.status` — see
> [`requirements-product-ranging.md`](requirements-product-ranging.md). Whether a branch
> carries a line is a merchandising decision reviewed occasionally; what it holds today is
> inventory state changing continuously, and the two were split so `find-product` is not
> blocked behind this whole model. `is_stocked_item = 0` becomes `status = 'non_stock'`.
> There is deliberately **no foreign key** from `stock` to `product_branch`: residual stock
> of a delisted line is a real state.

### Cost belongs here, not on `product`

`product.last_cost_pence` and `weighted_average_cost_pence` are single values with no branch
dimension, so the schema cannot currently express the everyday case: branch 5 bought a pile
of steel girders at a good price, my branch did not, and we hold the same product at
different cost. Cost is a `(product, branch)` fact and belongs on `stock`.

The product-level figures stay useful as a group view — a national average, or the cost a
buyer negotiates centrally — but they are not what a branch's margin is calculated from.

**The sales side already gets this right and should be left alone.** `aged_debt` carries
`cost_pence` per invoice, snapshotting the cost actually used at the moment of sale rather
than recomputing from a weighted average that has since moved, and it distinguishes
`order_taking_branch_id` from `issuing_branch_id` — which is exactly "my branch took the
order, branch 5 issued the steel".

### Inter-branch transfers, and the specialist branch

The transfer-price problem from §2c again, one level down and far more common. Two shapes:

- **Opportunistic.** My branch is out, another has plenty, I fulfil from theirs. The cost
  behind that sale is not my branch's last or average cost.
- **By design.** A 20-branch merchant keeps one specialist branch stocking every bath and
  basin in every size, buying on better terms because of the volume. Every other branch
  IBTs items in as they sell them, so for that category the IBT *is* the normal supply route.

**The specialist branch is already expressible** with the fields above: it carries
`product_branch.status = 'stocked'` across the category with real `min_qty`/`max_qty`, while
the other 19 branches hold `'non_stock'` — obtainable, not held. Generation should produce at
least one such branch, or `multi-branch-stock` has nothing interesting to show and the whole
component looks pointless.

### How a product is replenished, per branch

A product is not sourced one way company-wide. The specialist branch buys baths from the
supplier; the other nineteen IBT them in. Same product, different route depending on which
branch is asking — so this sits on `stock` beside the cost and min/max policy, not on
`product`.

```sql
stock.replenish_method   TEXT NOT NULL CHECK (replenish_method IN
  ('supplier',        -- ordered in from a supplier, at a named distribution point
   'supplier_direct', -- supplier ships straight to site; product.allow_direct_ex_works
   'ibt',             -- always transferred from a nominated branch
   'made_to_order',   -- machined at a nominated branch, then transferred
   'not_stocked'))    -- special order only
stock.source_branch_id           INTEGER  -- for ibt / made_to_order
stock.supplier_location_id       INTEGER  -- for supplier / supplier_direct
stock.lead_time_days             INTEGER  -- see below
```

**Multiple distribution points per supplier** mirror `customer` → `customer_delivery_address`
exactly: you pick the supplier, then pick the despatch depot. **There is still one supplier
account for settlement.** The depot is where goods come *from*, not who you owe — account
code, terms, VAT number, currency and status all stay on `supplier` and must not be
duplicated onto the depot, or the same trading relationship starts arriving on two ledgers.

```sql
CREATE TABLE supplier_location (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL,          -- settlement stays here
  code TEXT NOT NULL, name TEXT,
  address_1 TEXT, address_2 TEXT, town TEXT, county TEXT, postcode TEXT, country TEXT,
  telephone TEXT, email TEXT,
  collection_instructions TEXT,          -- the counterpart of delivery_instructions
  added TEXT, archived INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_supplier_location ON supplier_location(supplier_id, code);
CREATE INDEX ix_supplier_location_supplier ON supplier_location(supplier_id);

-- Which depot a branch normally uses for a supplier. Curated, for the same reason
-- branch_neighbour is: "nearest" is drive time, not straight-line distance.
CREATE TABLE branch_supplier_location (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  supplier_location_id INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_branch_supplier_location
  ON branch_supplier_location(branch_id, supplier_id);
```

`stock.supplier_location_id` then stays as an override, for the products that only ship from
one depot whatever the branch would normally use.

**Two things carried over from doing the customer side:**

- The generated `customer_delivery_address` has **zero archived rows**, so that path has
  never run against real data. Depots close and get consolidated more often than delivery
  addresses do — generate some archived ones here.
- `<merchant-delivery-address>` is the same component shape: a list of addresses belonging to
  a parent record, one chosen, delivery/collection detail on the card. A supplier-depot
  picker is largely that component with different labels, and the two should be built to
  match rather than diverging by accident.

**`made_to_order` is not the same as `ibt`**, and the difference is the whole point: the
timber processing plant does not hold the machined skirting, it makes it. Its stock figure is
legitimately nought. The two `works_order` permissions already in the model are exactly this
route — `raise_sales_works_order` machines it against a customer order,
`raise_stock_works_order` machines it to replenish stock.

### Preferred and alternative suppliers

`product.default_supplier_id` is a single FK, so the schema cannot say a tile comes from
Marley preferably and Tiles UK otherwise. That needs a many-to-many with an order of
preference:

```sql
CREATE TABLE product_supplier (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,                  -- 1 = preferred
  supplier_product_code TEXT,            -- what THEY call it
  min_order_qty NUMERIC,                 -- MOQ: below this the route is unavailable
  order_multiple NUMERIC,                -- pallet, box, bundle
  lead_time_days INTEGER,
  cost_pence INTEGER,
  requires_accreditation_id INTEGER      -- null = anyone may order
);
CREATE UNIQUE INDEX ux_product_supplier ON product_supplier(product_id, supplier_id);
CREATE INDEX ix_product_supplier_seq ON product_supplier(product_id, seq);
```

**`supplier_product_code` is the one most often left out and always needed.** You order
Marley's code, not yours, and goods-in reconciles the delivery note against their code. Its
absence surfaces late, as a booking-in clerk retyping codes by hand.

### Why a preferred supplier may be unavailable

The preference is not always the route taken, and the reasons are structural rather than
commercial:

- **Accreditation.** A manufacturer will only supply direct where the branch has an
  accredited product specialist. That is a property of the *branch*, not the product.
- **Minimum order quantity.** Below the manufacturer's MOQ the order has to go through a
  distributor, who will break a pallet.

```sql
CREATE TABLE accreditation (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT
);
CREATE TABLE branch_accreditation (
  id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL, accreditation_id INTEGER NOT NULL,
  valid_from TEXT, valid_to TEXT
);
CREATE UNIQUE INDEX ux_branch_accreditation
  ON branch_accreditation(branch_id, accreditation_id);
```

Also wanted on `supplier`: a **`supplier_type`** of `manufacturer` or `distributor`. It is
what makes the accreditation rule explicable — manufacturers impose it, distributors exist
partly to serve the branches that fail it.

**This is a decision made at order time, not static configuration.** Sourcing walks the
preference order and takes the first route the branch is actually eligible for: Marley if
the branch holds the accreditation and the quantity clears the MOQ, Tiles UK otherwise, at a
worse price.

Which supplies the mechanism behind something asserted earlier in this document. Per-branch
cost is not only "who negotiated better" — **a branch without the accreditation
structurally pays more for the same tile**, every time, and that is a fact about the branch
rather than about its buyer.

It also explains the permission split already in the model:
`raise_purchase_order` covers the default supplier, `raise_purchase_order_any_supplier` the
alternatives. Moving off the preferred route is exactly the decision that wants the wider
permission, because it costs more.

### What this changes in the components

This is worth settling **before** `stock-check` and `multi-branch-stock` are built, because it
decides what they are supposed to say. Both are currently blocked on this table.

| Branch shows 0 on hand | Without the route | With it |
|---|---|---|
| `ibt` from branch 5 | "Out of stock" | "None here — 40 at Stockport, your nominated source" |
| `made_to_order` at the mill | "Out of stock everywhere" | "Made to order, about 5 days" — a zero that is not a shortage |
| `supplier` | "Out of stock" | "On order, due Thursday, from the Leeds depot" |

Without the route, a made-to-order product reads as unavailable at every branch in the
network, which is the most misleading thing the stock component could say: the counter turns
away an order for something the business makes to order every week.

`lead_time_days` is what turns "branch 5 has 40" into something a counter hand can promise a
customer. Transfer lead time between branches and machining lead time are different numbers
and both belong on the route.

Missing, and needed before any of this can be transacted:

- an **IBT table** — sending and receiving branch, product, quantity, transfer value, dates.
  The `raise_ibt` permission already exists in the permission model and is the control.
- a decision on **transfer value**: at the sending branch's cost, at a group standard cost,
  or at cost plus a handling margin. For the specialist-branch model this decides whether the
  specialist keeps the buying advantage it earned or passes it to the branch that sells the
  bath — which is a P&L allocation question, not a technical one.
- **weighted average cost is per branch and moves on receipt.** A branch receiving an IBT at
  a different value has its average shifted by it, exactly as a purchase would. That only
  works if the cost columns are on `stock`.

Needs deciding: **tally products** (27 of them) carry per-length tallies, and real stock for
those is a quantity *per length*. Recommendation is an aggregate quantity now and a
`stock_tally_line` child table later, so the components are not held up.

Realism matters here more than elsewhere: some products out of stock everywhere, some at
one branch only, some below reorder level, some with `allocated > on_hand`. Flat random
data makes every component look the same.

---

## Quantity entry needs data that is not there

`<merchant-qty-input>` supports five entry modes; the dataset can only demonstrate three.
Both gaps are small generation changes, and both matter because quantity entry is the thing
merchants judge the software on.

**Fixed tallies.** `product.tally_id` is **0 for all 3,714 products**, so nothing references
the `tally` table — which already holds ten well-formed length lists (`2.4,3,3.6,4.2,4.8` for
C16 CLS, and so on). Point the CLS and redwood products at the tally that matches their
description and the mode works against real products instead of a prop override.

**Pack and pallet pricing.** Every `product_price` row has `divisor = 1`, so no product is
priced "per 100" or "per 1,000" even though `unit_of_measure` carries divisors of 2, 10, 12,
20, 100, 336, 400, 500 and 1,000 — the brick-pallet rows exist and are unused. Price a few
bricks per 1,000 against a 336 or 500 pallet, and some fixings per 100.

Without these, the two modes that most distinguish merchant software from packaged ERP can
only be shown with hand-set props.

### Tally pricing basis changes with order size

`unit_of_measure` already carries all four tally bases — `per mtr`, `per 100 mtr`, `per m3`,
`per cu ft` — because how a tally is priced depends on how much is being bought: a few
lengths go per metre, a lorry goes per cubic metre.

**Every tally product has exactly one price row, in m³**, so that cannot be expressed. Two
things are needed:

- `product_price` rows in more than one tally unit for the same product.
- A way to say which basis applies at which quantity. `price_break_tier` has `qty_from` and
  `qty_to` but applies a **discount percentage within a single unit** (Kronospan sheets:
  1–5 at 0%, 6–10 at 10%, 11–20 at 30%, 20+ at 40%). It cannot switch the unit. Adding
  `price_break_tier.unit_of_measure_id` would let a tier say "above 100 metres, price per m³".

Note also that `price_break` is barely used: 3,697 of 3,714 products point at
"All products without quantity breaks", and only 17 at a real one.

### Random-length packs, and grade

A pack of 80 pieces of 25×50 may be all 3.6 m, or mixed lengths. The schema can say how many
pieces are in a pack (`qty_per_outer`, `qty_per_pallet`) but not which of those it is, and
the distinction changes the price:

- **short random lengths** sell at a discount — they are harder to use
- **long random lengths, clean** attract a premium — clear of knots and usable whole

So a pack needs two facts it does not have: whether its lengths are fixed or random, and its
grade. Suggested:

```sql
product.is_random_length  INTEGER NOT NULL DEFAULT 0
product.grade             TEXT     -- clean / unsorted / sawfalling / FAS ...
product.is_random_width   INTEGER NOT NULL DEFAULT 0
```

`is_random_width` is separate from `is_random_length` and both are real: hardwood is random
in both, a softwood pack is a fixed section with random lengths only. The quantity component
currently infers this from a `randomWidth` property because nothing in the data says it —
and getting it wrong means either hiding a width that varies, or offering a width field on a
fixed section where typing in it silently changes the price.

`product.specification` is a JSON column and is `{}` on every row; grade could live there,
but a column is better for something that price depends on.

---

## Product compliance: certification and hazard documentation

Two different obligations with the **same structural shape**: a fact about the product, and
an auditable record of what was given to which customer and when. The schema has neither
half of either.

The evidence-of-supply half is the one usually missed. Holding the document is not the
obligation; **issuing it, and re-issuing it when it changes**, is.

### Certification is currently a substring

```
products with FSC in the name:   169
products with PEFC in the name:   68
a certification column:          none
```

> `3000x75x47mm C16 Timber Untreated Kiln Dried Regularised FSC`

Reasonable when FSC was a marketing suffix. UKTR due diligence, EUDR and buyers asking for
EPDs have turned chain of custody into an auditable fact with a scheme, a certificate number
and per-consignment traceability. A substring cannot be reported on, filtered by, or shown to
an auditor.

```sql
CREATE TABLE certification_scheme (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL   -- FSC, PEFC, ...
);
product.certification_scheme_id  INTEGER
product.certificate_number       TEXT   -- the merchant's own chain-of-custody code
product.certified_from           TEXT
product.certified_to             TEXT   -- certificates expire; selling on a lapsed one is the risk
```

`certified_to` matters as much as the number: a lapsed certificate is worse than none,
because the claim is still being made on the invoice.

### Hazardous goods and safety data sheets

The dataset carries **19 product groups** of chemicals — building chemicals (Sika, Mapei),
cement, trade paints, wood finishes, sealants and adhesives — and roughly 200 products by
name. There is **no hazard field anywhere and no record of any document being sent**.

**Cement is the sleeper.** 34 products, and it is a skin sensitiser requiring warnings.
Everyone remembers the solvents and forgets the bagged cement, which is far higher volume.

```sql
product.is_hazardous       INTEGER NOT NULL DEFAULT 0
product.signal_word        TEXT     -- Danger / Warning
product.hazard_statements  TEXT     -- H-codes, CLP
product.un_number          TEXT     -- transport, ADR
product.sds_version        TEXT
product.sds_issued_at      TEXT
product.sds_url            TEXT

-- The compliance half: evidence that the customer was given it.
CREATE TABLE customer_document_issue (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  document_type TEXT NOT NULL,      -- sds | certificate | declaration_of_performance
  document_version TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  channel TEXT NOT NULL,            -- email | printed | portal
  app_user_id INTEGER               -- who issued it
);
CREATE INDEX ix_customer_document_issue
  ON customer_document_issue(customer_id, product_id, document_type);
```

The obligation is triggered **at or before first supply, and again whenever the sheet is
revised** — so the question a counter needs answered is not "is there an SDS" but "has this
customer had the current version". That is a query against the table above, and it is the
reason it cannot be a flag on the customer or a file on a shared drive.

### What this means for the components

- **find-product** and **product-detail** should show a hazard marker, because it changes
  what the counter has to do before goods leave.
- The **counter-sale and delivered-sale flows** need a check in the same family as the credit
  verdict: *this order contains hazardous goods and the customer has not had SDS v4*. It is
  a cross-component rule — the products come from the order, the issue history from the
  customer — so it belongs in the flow layer beside the on-stop and away-from-home-branch
  warnings.
- `un_number` affects **delivery**, not just the counter: quantities above the limited-load
  threshold change what the driver needs.

`product.specification` is JSON and already populated on 3,701 of 3,714 rows, but only ever
with `material` and `source`. Hazard data could be tucked in there; it should not be, because
compliance data gets queried, filtered and audited, and a JSON blob makes all three awkward.

### Age-restricted supply

Bladed articles and corrosives cannot be supplied to under-18s. The dataset carries knives,
saw and plane blades and chisels, and no field says so.

**This check is structurally unlike every other one in the system, and that is the point.**

| Check | Is about |
|---|---|
| credit status | the **account** |
| permissions | the **staff member** |
| safety data sheet | the **product**, and whether this customer has had it |
| **age restriction** | **the individual standing at the counter** |

A trade account is held by a forty-year-old builder; the apprentice sent to collect is
seventeen. The account holder's age is irrelevant and the person who matters is very often
not in the system at all. So this cannot be a flag on `customer`, and it cannot be answered
from anything the order already knows.

```sql
product.min_age              INTEGER   -- 18 for bladed articles and corrosives
product.restriction_reason   TEXT      -- bladed_article | corrosive | solvent | precursor

CREATE TABLE sale_age_check (
  id INTEGER PRIMARY KEY,
  -- the sale or collection this belongs to
  customer_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  app_user_id INTEGER NOT NULL,     -- who served, and carries the consequence
  checked_at TEXT NOT NULL,
  outcome TEXT NOT NULL,            -- passed | refused | not_required
  id_type TEXT,                     -- passport | driving_licence | pass_card
  collector_name TEXT               -- who took it, not who owns the account
);
```

**Refusals must be recorded, not just passes.** The due-diligence defence rests on showing a
policy operated consistently, and a log containing only successful sales demonstrates
nothing.

### Delivery breaks the counter model

An age check cannot happen at a counter for goods going on a lorry. Either the driver checks
on handover — which needs the requirement to travel with the delivery — or the remote sale
is refused outright.

And there is a harder rule: **corrosives sold remotely may not be delivered to residential
premises at all.** That needs to know whether a delivery address is residential, and:

> `is_residential` **is already computed** during generation, on the `address_pool` staging
> table, where it picks the street-naming style. `address_pool` is then dropped as staging
> and the flag is discarded. It never reaches `customer_delivery_address`.

Carrying it through is a two-line change and turns an unanswerable question into a lookup.

### What this means for the components

- **qty-input / find-product** — a restriction marker, because it changes what happens before
  goods leave.
- **The counter-sale flow** needs an age gate in the same family as the credit verdict and
  the SDS check: same shape, different subject. The flow layer is where it belongs, since the
  restriction comes from the products and the outcome attaches to the person collecting.
- **delivery-address** should show residential status once it exists, because it decides
  whether some goods can go there at all.
- The **permission model** already has the shape for who may override a refusal —
  `approval_rank` and the escalation chain — if overriding is ever allowed. It probably
  should not be.
