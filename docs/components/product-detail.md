# product-detail

`<merchant-product-detail>` — one line in full, from one branch.

## Current version: 0.1.0

The card find-product hands off to. It answers what a counter hand asks once they have found
the line: what does it cost, in what unit, how many come on a pallet, who supplies it — and,
the one a catalogue card usually forgets, **whether this branch may sell it at all**.

Availability is carried straight through from the ranging model rather than dropped on the
way. A detail card that omits it repeats exactly the mistake find-product exists to avoid,
and the two are shown moments apart, so both read the same
[`shared/availability.js`](../../src/components/shared/availability.js) — a badge saying "In
range" in the list and something else on the card would be a bug nobody would think to test
for.

## `tier` is not a quantity break

This is the thing the card had to get right, and it is not what the schema suggests.

| | products | what `tier` means |
|---|---:|---|
| Degenerate scheme (`qty_from = qty_to = 1`) | **3,697** | a **customer price band** — four prices simply descending, 2250 → 2025 → 1913 → 1845 |
| "Cement and bagged binders" | **17** | a genuine **quantity break** — 1–9, 10–25, 26–50, 51–9999 at 0/5/10/15% |
| "Kronospan decorative sheets" | **0** | real ranges defined, no product uses them |

So a quantity range is attached **only where the scheme defines one**, and the table heading
switches between `Quantity` and `Band` accordingly. Joining `product_price.tier` to
`price_break_tier.seq` unconditionally would print **"qty 1–1"** against 99.5% of the
catalogue and be confidently wrong.

The footnote says which kind is on screen, because *"no quantity breaks"* and *"quantity
breaks we are not showing you"* must not look the same at a counter.

**464 products carry more price rows than their scheme has tiers** — the 17 quantity-break
lines all have 6 prices against a 4-tier scheme. Those extra bands get no range rather than a
fabricated one.

## Prices group by unit, never a grid

266 products are priced two ways and the band counts differ — four bands per sheet, two per
10m². A `tier × uom` grid would have holes in it and imply prices that do not exist, so each
unit gets its own block.

**The unit sits in the Price column header** — `Price each`, `Price per 10m²` — rather than
in a caption bar above the table. "Priced each" as its own row said little that "Price each"
does not, and the `uom_type` shown beside it ("sheet material") said nothing at all: it is a
schema enum, not a fact about the product. One header row per block instead of two, with the
unit still travelling with the figures it qualifies.

Clicking a band emits `merchant-product-price-selected`.

## VAT-inclusive prices

`vatInclusive` shows selling prices with VAT added — what a retail caller asking *"what will
it cost me?"* wants. Off by default, because the trade counter works ex-VAT and that is the
figure on the order.

|  | Bands |
|---|---|
| default | £22.50 · £20.25 · £19.13 · £18.45 — *"Prices exclude VAT (STD 20%)"* |
| `vatInclusive` | £27.00 · £24.30 · **£22.96** · £22.14 — *"Prices include VAT at 20%"* |

An **`Includes VAT`** badge sits beside the **Selling prices** heading, in the same amber as
`Other branches` — above the figures rather than under them, because a footnote is read after
the price has been quoted and £27.00 misheard as ex-VAT is a 20% error out of the door. Only
the inclusive case is badged; ex-VAT is what the counter expects, and badging the expected
state teaches people to ignore the badge.

**The emitted price never changes meaning.** `pricePence` is always the ex-VAT figure —
that is what an order line carries, and letting a display toggle redefine it would surface
as a 20% error in someone else's total. The event gains `pricePenceIncVat`, `vatRate` and
`shownIncVat` alongside it.

**Rounded to the nearest penny**, which makes an inclusive unit price indicative rather than
exact: £19.13 × 1.2 is 2295.6p and shows as **£22.96**. Real VAT is computed once on the
invoice total, not per line, so three of those inclusive will not tally exactly with VAT on
three ex-VAT. Fine for a counter enquiry, and the reason the ex-VAT figure stays
authoritative.

**Zero-rated and exempt are handled rather than dressed up.** Both arrive as rate 0, so the
inclusive figure equals the exclusive one; the note then reads *"No VAT on this line
(ZERO)"* rather than *"includes VAT at 0%"*, which would read as a bug. No product currently
carries either — all 3,714 are STD 20% — but the rates exist in `tax_rate`.

**Cost is unaffected.** Input tax is reclaimed, so cost is ex-VAT by nature.

The maths lives in [`shared/format.js`](../../src/components/shared/format.js) as `withVat`,
so find-product can adopt the same toggle without a second implementation.

## Cost is off by default

Counter staff generally may not see cost. `showCost` defaults **false**, and when switched on
the card says plainly that it is **not permission-gated**, because the dataset has no
`view_cost` permission to gate it on. The 15 permissions cover sales, credit, purchasing,
stock and works orders; none covers seeing cost or margin. Using `override_selling_prices` as
a proxy would be wrong — that is about *changing* a price, not *seeing* what it cost.

Recorded as an upstream gap rather than invented locally.

## Properties

| Property | Type | Default | Notes |
|---|---|---|---|
| `productId` | number | — | Required |
| `workingBranchId` | number | — | A branch **id**, not a code. Decides the availability verdict and which other branches are listed |
| `showCost` | boolean | `false` | Cost and margin. See above |
| `vatInclusive` | boolean | `false` | Selling prices with VAT added, for a retail enquiry. The emitted price stays ex-VAT |
| `selectedTier` | number | `0` | Highlight a band, as if a tier were already chosen |
| `heading` / `dense` | | | Presentation |

## Events

| Event | Detail |
|---|---|
| `merchant-product-price-selected` | `{ productId, productCode, tier, uomId, per, divisor, pricePence, pricePenceIncVat, vatRate, shownIncVat, qtyFrom, qtyTo }` |
| `merchant-product-detail-loaded` | `{ productId, availability, branchId }` |

## In the counter-sale flow

Step 5, between find-product and the delivery address: *"Price it — which band, and can this
branch supply it?"* It takes both the product **and** the working branch, because the same
line is a different answer at a different yard.

## Three data traps this walked into

Worth recording, because all three rendered plausibly and were only caught by looking:

1. **`unit_of_measure.description` is internal configuration guidance, not a label.** It
   reads "Use for unit products. Qty x price with divisor of 1". It was being shown as the
   price-block caption and as the weight unit, producing *"Weight: 2.38 Use for unit
   products…"*. The block now uses `uom_type`, and weight uses `per`.
2. **`specification` is JSON, not prose** — `{"material": …, "source": …}` — and `"{}"` is a
   truthy string, so an empty one printed a literal `{}` on the card. Now parsed, with URLs
   as links, under its own heading. Unheaded it ran on from **Supply**, where the two
   different meanings of "Source" (`purchased` vs a URL) sat one above the other.
3. **The mass unit is not recorded.** `weight_uom_id` names the *basis* — "per each", "per
   pack" — not kilograms, and no product points it at the `kg` or `tonne` rows that exist in
   `unit_of_measure`. The card prints `2.38 per each`, which is truthful; inventing "kg"
   would not be, even though the data settles it (770 per m³ on American White Oak is
   timber density). Raised as [`upstream-requests.md`](../upstream-requests.md) §2e.

## Not yet

- **Retrospective discounts** and **supplier support contracts**
  (`docs/must-cater-for.md`) — the price bands here are not the final price, and neither is
  modelled upstream.
- **Hazard documentation and certification** — specced in
  [`requirements-stock-sourcing.md`](../requirements-stock-sourcing.md), no data yet. FSC/PEFC
  currently survives only as a substring in 237 product names.
- **Stock** — this says whether a branch *ranges* a line, never how many it has. That stays
  blocked on the `stock` table.
