# find-product

`<merchant-find-product>` — the catalogue, seen from one branch.

## Current version: 0.2.1

**0.2.1** — fix a dead end: with `collapseOnSelect`, clearing the search box left the selected
card on screen with no results, no hint and nothing to search from. Adds "New search",
Escape, and scenario presets. Corrects the `workingBranchId` default, which was passing a
branch *code* where an id was wanted.

**0.2.0** — browse a product group with no search term, paged. `limit` becomes `pageSize`
(default 20). The group facet now offers parent groups, not only leaves.

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

## Browsing a group

Picking a group with **no search term** browses it, rather than returning nothing. A filter
that stays empty until you also type something reads as broken — choosing
`Top.Timber.Joinery.Sawn` is already a complete question.

An empty box with **no** filter stays a cold start: the hint is more use than page 1 of 3,714
lines. A filter is what turns the box into a browse.

**The facet offers parent groups, not just leaves.** Products hang off leaf groups, so
counting products per group offers only the 91 leaves — `Top.Timber.Joinery.Sawn` but never
`Top.Timber`. The parents are the useful browse targets, and the subtree filter already
supported them, so leaving them out made a working feature unreachable. Counts roll up in JS
over leaf counts; doing the ancestor match as a SQL self-join on the path measured **51 ms**
against 2.15 ms, for a facet that reloads on every branch change.

Facet counts and browse counts are computed two different ways — a JS rollup and a SQL
subtree `LIKE` — so a test asserts they agree. `Top.Timber` says 272, and browsing it returns
272.

## Paging

`« First · ‹ Prev · Page [n] of N · Next › · Last »`. The page box accepts a typed number and
clamps out-of-range values. First/Prev disable on page one, Next/Last on the last page, and
the pager hides entirely below one page.

The count line reads `21–40 of 272` rather than `20 of 272`: which rows these are, not just
how many exist.

**`p.id` is the final tiebreak in the ORDER BY, and it is not decoration.** Without a total
order, two rows tying on name can swap between pages — one product shows twice, another never
shows at all. That only appears once paging exists, and it looks like data loss rather than a
sort bug. A test pages through a whole group and asserts the result is identical to the
unpaged list.

Changing the term, group, scope, branch or page size resets to page one. Staying on page 7
after switching to a three-page group shows an empty list and reads as a bug.

## Ordering

In SQL, not re-sorted in JS after a `LIMIT` has already thrown the interesting rows away:

1. exact code, then code prefix, then name
2. then what can be sold now, in the order it can be sold: `core`, `stocked`, `non_stock`,
   ranged-elsewhere, ranged-nowhere
3. `not_permitted` sinks to the bottom

## Price carries its unit, always

266 products change pricing unit **between tiers** — per each up to tier 4, per pallet at 5.
A bare pence figure is meaningless against those, so the tier-1 price is always shown with
its unit (`£18.50 each`, `£42.00 per 10m²`), and a `‡` marks a product priced more than one
way, meaning open the detail rather than quote from the list. The marker binds to the price
group with no space: as `£18.50 each +` it read as a conjunction joining the price to the
supplier name beside it.

## Properties

| Property | Type | Default | Notes |
|---|---|---|---|
| `workingBranchId` | number | — | Required unless `scope="all"`. A branch **id**, not a branch code — they differ, and code `13` is id `7`. Which branch is the specialist is picked at generation time, so use the "Specialist branch" scenario rather than a hardcoded id |
| `scope` | `branch` \| `all` | `branch` | `all` still reports each product's state at the working branch |
| `groupPath` | string | `""` | Group and everything beneath — `Top.Timber` includes `Top.Timber.Joinery.Sawn` |
| `showGroupFilter` | boolean | `true` | Lists only groups the branch ranges something in when branch-scoped |
| `collapseOnSelect` | boolean | `false` | On for flows, off on the component page where browsing is the point |
| `dense` / `zebra` | boolean | `false` | As find-customer |
| `pageSize` | number | `20` | Results per page. API caps a page at 500, and says so |

## Getting back out of a selection

With `collapseOnSelect`, picking a product replaces the list with a card. Four ways back,
because the flow mounts it this way and a counter hand who picked the wrong thing must not be
stuck:

| | |
|---|---|
| **Back to results** | the list this was picked from — "wrong one of these". Only offered when there was more than one |
| **New search** | clears the box and focuses it — "wrong search". The box keeps the old term after a pick, so without this the only way out is to select the text and overtype |
| **Escape** | same as New search, from the keyboard |
| **just typing** | any keystroke abandons the pick |

Changing branch or scope also clears the card, because availability is a per-branch fact:
after a branch change the card is not stale, it is **wrong**.

**The bug this fixes:** `runSearch()` returns early on an empty box, and the selection reset
sat *after* that return. So clearing the box never cleared the selection — card still showing,
no results, no hint, no way forward. The reset now lives in `onInput()`, where the intent
actually is. It is also no longer in `runSearch()` at all, so paging does not silently drop a
selection.

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

## Scenarios

Five presets resolve the interesting states from the data rather than needing them typed in
from memory: the specialist branch, a branch holding a line it may not sell, a group worth
browsing, the thinnest range, and **collapse-on-select** — the shape the counter-sale flow
mounts. That last one is there because the collapsed state has its own ways back out and the
component page never exercises them, which is exactly how the dead end below shipped.

## Measured

Against the real 47,704-row `product_branch`:

| Query | |
|---|---:|
| name tokens, branch-scoped | 0.75 ms |
| exact code | 1.86 ms |
| barcode | 0.41 ms |
| group facet (108 groups, rolled up) | 2.15 ms |
| browse a group, one page of 272 | 2.31 ms |
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
