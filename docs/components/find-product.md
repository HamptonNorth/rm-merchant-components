# find-product

`<merchant-find-product>` — the catalogue, seen from one branch.

## Current version: 0.1.0

The customer search answers *who is this*. This one answers *can I sell you this, from here,
today* — and that is the question a counter hand actually has. A product search that returns
a hit without saying whether the yard carries it is worse than one that finds nothing: it
invites someone to promise stock that has never been on site.

## Availability is the point

Every result carries one of five states, derived server-side in `availabilityOf()` so the
API, the component and anything built later cannot disagree about what a missing ranging row
means.

| State | Ranging | Counter can | Shown |
|---|---|---|---|
| **In range** | `core` or `stocked` | sell now | green |
| **To order** | `non_stock` | sell, obtained per order | blue |
| **Other branches** | no row here, ranged elsewhere | sell, transfer in — with the branch count | amber |
| **Special order** | ranged nowhere | sell, ordered from the supplier | grey |
| **Not permitted** | `not_permitted` | **no** | red, greyed, unselectable |

**Absence of a ranging row is not an error and not "unavailable".** It means the branch does
not range the line, which still leaves it sellable as a special order. The one negative
stored explicitly is `not_permitted`, because it has to beat that default — the branch with
no accreditation, or an age-restricted line where there is no process to check ID.

`not_permitted` rows are **shown greyed rather than hidden**. "Why can I not find it" is a
worse counter experience than seeing the line with a reason attached, and `select()` refuses
them, so a blocked product cannot reach an order.

## Routing

One box. Nobody picks a mode first.

| Typed | Route | Example |
|---|---|---|
| 8–14 digits | barcode, matched against inner / outer / pallet | `5055149904301` |
| 2+ chars, no spaces | code prefix **and** name | `04B`, `0442BBBPLY` |
| 3+ chars | name tokens, ANDed in any order | `birch ply` = `ply birch` |

Code and name are matched in the **same** query rather than routed between, because the
shapes overlap far more than they do for customers — product names are full of digits
(`25 x 50mm`). An exact code sorts above a code prefix, which sorts above a name hit.

**The minimum length guards the name search, not the route.** `04` is a useful code prefix
and costs an index seek; running `name LIKE '%04%'` beside it is a different search and not
cheap. Getting this wrong once meant `pl` returned 525 products on two characters. Measured
on the whole term, not per token, so `25 x 50` still works.

## Ordering

In SQL, not re-sorted in JS after a `LIMIT` has already thrown the interesting rows away:

1. exact code, then code prefix, then name
2. then what can be sold now, in the order it can be sold: `core`, `stocked`, `non_stock`,
   ranged-elsewhere, ranged-nowhere
3. `not_permitted` sinks to the bottom

## Price carries its unit, always

266 products change pricing unit **between tiers** — per each up to tier 4, per pallet at 5.
A bare pence figure is meaningless against those, so the tier-1 price is always shown with
its unit (`£18.50 each`, `£42.00 per 10m²`), and a `+` marks a product priced more than one
way, meaning open the detail rather than quote from the list.

## Properties

| Property | Type | Default | Notes |
|---|---|---|---|
| `workingBranchId` | number | — | Required unless `scope="all"`. Branch 13 (Leeds) is the specialist branch, where the states differ most |
| `scope` | `branch` \| `all` | `branch` | `all` still reports each product's state at the working branch |
| `groupPath` | string | `""` | Group and everything beneath — `Top.Timber` includes `Top.Timber.Joinery.Sawn` |
| `showGroupFilter` | boolean | `true` | Lists only groups the branch ranges something in when branch-scoped |
| `collapseOnSelect` | boolean | `false` | On for flows, off on the component page where browsing is the point |
| `dense` / `zebra` | boolean | `false` | As find-customer |
| `limit` | number | `25` | API caps at 500, and says so |

## Events

| Event | Detail |
|---|---|
| `merchant-product-selected` | `{ product, availability, branchId, scope }` |
| `merchant-product-search-widened` | `{ scope, term }` |

## In the counter-sale flow

Sits between the credit check and the delivery address, and adds the cross-component warning
neither component can make alone — find-product knows the line is not held here, and only the
flow knows nobody has chosen a delivery address, which is what makes it a collection:

> *Bostik Pro S31 Sanitary Silicone is not ranged here — 12 branches carry it. A collection
> customer cannot take it today.*

## Measured

Against the real 47,704-row `product_branch` at branch 13:

| Query | |
|---|---:|
| name tokens, branch-scoped | 0.75 ms |
| exact code | 1.86 ms |
| barcode | 0.41 ms |
| group facet (90 groups) | 2.1 ms |
| `ranged_branches` count per row | 0.002 ms |

No FTS. Unindexed `LIKE` over 3,714 products is 0.01–0.35 ms and extrapolates to ~2.3 ms at
a 25,000-product catalogue; `customer_fts` earned its trigram index at 39,452 rows, and the
catalogue is an order of magnitude smaller.

## Known data gaps

- **Barcodes are 5% populated** — 185 of 3,714 have `barcode_inner`, and `barcode_outer` /
  `barcode_pallet` are empty on every row. The barcode route works but is barely testable.
- **56 sheet-material products are priced per each** rather than per 10m². Their prices point
  at unit-of-measure 1 instead of 201.

Both are `datagenerator2` generation gaps, recorded in
[`../upstream-requests.md`](../upstream-requests.md) §2d.

## Not yet

Supplier and unit-of-measure facets — the API serves `/api/products/suppliers`, the component
does not use it. Deferred because the group filter alone answers most narrowing, and a second
dropdown wants to be designed with the first rather than bolted beside it.
