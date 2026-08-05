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

Clicking a band emits `merchant-product-price-selected`.

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
| `selectedTier` | number | `0` | Highlight a band, as if a tier were already chosen |
| `heading` / `dense` | | | Presentation |

## Events

| Event | Detail |
|---|---|
| `merchant-product-price-selected` | `{ productId, productCode, tier, uomId, per, divisor, pricePence, qtyFrom, qtyTo }` |
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
   pack" — not kilograms. The card prints `2.38 per each`, which is truthful; inventing "kg"
   would not be.

## Not yet

- **Retrospective discounts** and **supplier support contracts**
  (`docs/must-cater-for.md`) — the price bands here are not the final price, and neither is
  modelled upstream.
- **Hazard documentation and certification** — specced in
  [`requirements-stock-sourcing.md`](../requirements-stock-sourcing.md), no data yet. FSC/PEFC
  currently survives only as a substring in 237 product names.
- **Stock** — this says whether a branch *ranges* a line, never how many it has. That stays
  blocked on the `stock` table.
