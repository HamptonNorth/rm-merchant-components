# qty-input

`<merchant-qty-input>` — how much, in the units the trade actually uses.

## Current version: 0.1.0

Every sales system handles *6 bolts at £2.50 = £15.00*. Rather fewer handle a pallet of 366
bricks priced per 1,000. Almost none handle a timber tally, and fewer still handle hardwood,
where every parcel is a different width and length and the volume is worked out board by
board. **This component is that gap.**

## Five modes, one output

| Mode | Entry | Example |
|---|---|---|
| `unit` | one number | 6 × £2.50 = £15.00 |
| `pack` | packs, showing the implied units | 1 pallet = 366 bricks |
| `sheet` | sheets, with the area they cover | 3 sheets = 8.20 m² |
| `tally_fixed` | pieces against a known list of lengths | 10 @ 2.4 m, 5 @ 4.8 m |
| `tally_variable` | hardwood, measured parcel by parcel | 3 @ 2.5 m × 210 mm |

Whatever is typed, one priced quantity comes out, **plus the working**: the event carries
`quantity` in the pricing unit and also `pieces`, `linearM`, `volumeM3` and the tally lines,
so an order line can show both "0.122 m³" and the tally that produced it.

The mode is decided server-side from the product's `uom_type` and how it is priced, not from
anything the UI knows.

## The same tally prices two ways

A tally totals to length *or* to volume depending on the unit the product sells in — running
metres for joinery sold by the metre, cubic metres for hardwood. Same entry, different
number, and the component takes it from the price row rather than guessing.

**266 products are priced in more than one unit** — a sheet by the sheet and by area — so
when there is a choice the counter gets a `Price by` toggle. The customer asks in one or the
other and both answers have to be immediate.

## Packs and sections

`packs` multiplies a tally, for a repeated make-up: four packs of the same 80-piece tally
rather than the tally typed four times.

`randomWidth` decides whether width is entered per line. **Hardwood is random in both width
and length**, so both are entered. **A softwood pack is a fixed section — 25×50 — with only
the lengths varying**, so the width column is hidden and taken from the product. Showing it
there invites someone to type into it and quietly change the price of a fixed section.

Nothing in the data distinguishes the two, so this is currently a property. `is_random_width`
and `is_random_length` are recorded as schema requests.

## Properties

| Property | Attribute | Type | Default | Notes |
|---|---|---|---|---|
| `productId` | `product-id` | number \| null | `null` | Product to price. |
| `uomId` | `uom-id` | number \| null | first | Which pricing unit; the toggle sets it. |
| `tier` | `tier` | number | `1` | Price tier to quote against. |
| `tallyLengths` | `tally-lengths` | number[] \| null | `null` | Fixed length list. See below. |
| `packSize` | `pack-size` | number \| null | `null` | Units per pack. See below. |
| `packs` | `packs` | number | `1` | Multiplies a tally, for repeated pack make-ups. |
| `randomWidth` | `random-width` | boolean | `true` | Width per line (hardwood) or fixed section (softwood pack). |

## Events

| Event | Detail |
|---|---|
| `merchant-qty-changed` | `{ productId, mode, uomId, per, quantity, unitPricePence, totalPence, pieces, linearM, volumeM3, lines }` |

## Three of the five modes have no backing data

Worth stating plainly, because the component supports more than the dataset can demonstrate:

| Mode | Data |
|---|---|
| `unit` | ✓ 11,085 price rows |
| `tally_variable` | ✓ 27 hardwood products priced per m³ |
| `sheet` | ✓ 56 products, dual-priced |
| `pack` | **none** — every `product_price` row has `divisor = 1`, though `unit_of_measure` carries divisors of 336, 400, 500 and 1,000 |
| `tally_fixed` | **none** — `product.tally_id` is **0 for all 3,714 products**, though the `tally` table holds 10 real CLS and redwood length lists |

`tallyLengths` and `packSize` exist so those two modes can be driven directly and exercised
in the harness. When the data catches up they become overrides rather than the only route in.
Both are generation requests for datagenerator2.

## The arithmetic

In `shared/quantity.js`, deliberately outside the component so it can be tested without a
DOM. It is the part that must not be wrong: the difference between selling a cubic metre of
oak and a thousandth of one is one misplaced division by 1000, and both look plausible on
screen.

Dimensions are millimetres on `product`; lengths are entered in metres. That is how each is
spoken at a counter — "25 mil oak, four two long" — and every conversion happens in one
place.

Two behaviours the tests pin because they are quiet when wrong:

- **A per-line width beats the product's nominal.** Hardwood is random width; if the nominal
  won, every board would price at 100 mm and the wide ones would be undercharged.
- **Partial input totals to zero, never `NaN`.** A half-typed tally row otherwise renders
  "£NaN" at the counter.

## Changelog

### 0.1.0 — 2026-08-04

Initial version. Five entry modes, dual-unit pricing, tally entry with running totals in
pieces, metres and cubic metres.
