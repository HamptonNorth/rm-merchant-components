# find-customer

`<merchant-find-customer>` — one text box at the trade counter.

## Current version: 0.1.0

The same box has to sell a 50p bolt for cash and 20 pallets of bricks on a credit account,
so it routes on what was typed rather than making anyone pick a search mode first.

## Routing

| Input | Route | Example |
|---|---|---|
| a single digit `1`–`9` | that branch's quick code — one cash account | `1` → *Cash Sale — Stockport* |
| the dataset's account-code shape | account code prefix | `CA/000` |
| 3+ chars starting letter(s) then a digit | postcode, **and** name | `SK4`, `SK4 1`, `SK41DR` |
| 4+ chars otherwise | name — every token must match | `arrowsmith`, `gate build` |

**Routing happens server-side.** The account-code shape is a property of the dataset, not of
the UI: datagenerator2 emits `9999999`, `XX/999999`, `XX/9999999` or `XXX/999999` from
`account_code_format`, and a rule keyed on "two letters then a slash" breaks under one format
and matches nothing under another. The server infers the shape from sampled `account_code`
values, so a regeneration with a different format needs no change here.
`GET /api/customers/search-shape` reports what it inferred.

### Name search matches part-words, in any order

Every whitespace-separated token has to appear somewhere in the name, independently:

| Typed | Finds |
|---|---|
| `gate build` | Gates Building Services · Bathgate Building Services |
| `build gate` | the same — order does not matter |
| `gates bui` | Gates Building Services |

So there is no need to type whole words, or to get them in the right order. Trigram FTS
matches substrings, and the tokens are ANDed.

Two details behind that:

- **Tokens shorter than three characters go to `LIKE` rather than being dropped.** Trigram
  cannot index below three, and `j smith` should still mean the name contains a j.
- **The search is column-scoped to `name`.** The FTS table also indexes town, and without the
  filter `gate` matches Gateshead — every builder in Gateshead came back for a search plainly
  about a company name.

Names containing the term exactly as typed sort first, so `gates building` puts the literal
match above one that merely holds both tokens somewhere.

Three further points where the behaviour is deliberately not the obvious thing:

- **A postcode-looking term searches names too**, not instead. "A1 Plumbing" starts like a
  postcode but is somebody's trading name. Postcode hits lead; name hits follow; each row
  carries `matched_on`.
- **Postcodes search from three characters**, where names need four. A UK outward code is
  often three (`SK4`, `CH1`, `B29`), and requiring four would mean typing the space before
  anything happened — which at a counter reads as the search being broken. It is affordable
  because a postcode prefix is an indexed seek (~0.02 ms); a three-character *name* search
  would return half the branch.
- **A postcode typed without its space still matches.** `SK41DR` is tried both as-is and as
  `SK4 1DR`, two indexed seeks.

## Scope and widening

Scoped to the working branch by default — the business rule, and it keeps the query cheap.
**National accounts are always included at every scope level**, because they are not really
branch-owned (docs/plan.md §0).

The widen control steps `branch` → `neighbours` → `all`. Neighbours come from the curated
`branch_neighbour` table rather than from the region map, which gets the interesting cases
wrong: Chester's neighbours include **Bangor**, across a regional boundary.

Widening matters most where the region map helps least — Newtown holds 91 customers and
Bangor 244, against Stockport's 3,635.

**Any row not owned by the working branch shows its owning branch in amber.** A Chester
counter serving a customer on Bangor's books needs to see that before taking the order: the
owning branch holds the pricing and credit relationship.

## Usage

```html
<script type="module" src="/src/components/find-customer/find-customer.js"></script>

<merchant-find-customer working-branch-id="3"></merchant-find-customer>
```

```js
find.addEventListener("merchant-customer-selected", (e) => {
  // matchedOn === "quick_code" means a counter cash sale, already decided
  startOrder(e.detail);
});

// Wire to the working-branch picker (docs/plan.md §0 — the host orchestrates)
workingBranch.addEventListener("merchant-working-branch-changed", (e) => {
  find.workingBranchId = e.detail.id;
});
```

## Properties

| Property | Attribute | Type | Default | Notes |
|---|---|---|---|---|
| `workingBranchId` | `working-branch-id` | number \| null | `null` | The branch this counter is working from. Required unless `scope` is `all`. |
| `scope` | `scope` | `branch` \| `neighbours` \| `all` | `branch` | Search scope. The widen control steps through these. |
| `heading` | `heading` | string | `"Find customer"` | Blank hides it. |
| `placeholder` | `placeholder` | string | … | Input placeholder. |
| `limit` | `limit` | number | `25` | Rows to return. The API caps at 500 and says when it did. |

## Events

| Event | Detail | When |
|---|---|---|
| `merchant-customer-selected` | `{ id, accountCode, name, accountType, creditStatus, isNationalAccount, isCounterAccount, homeBranchId, matchedOn }` | A result is clicked or chosen with Enter. |
| `merchant-customer-search-widened` | `{ scope, term }` | The widen or narrow control is used. |

`matchedOn` (`quick_code` / `account_code` / `postcode` / `name`) travels with the selection
because the order flow behaves differently after a quick code — that is a counter cash sale,
already decided — than after a name search.

## Keyboard

Arrow up/down move through results, Enter selects (the first row if none is highlighted),
Escape clears. A quick code pre-arms its single result, so `1` then Enter is two keystrokes
to the counter cash account.

Input is debounced at 180 ms, and out-of-order responses are discarded — a slower earlier
request cannot overwrite a faster later one.

## Row badges

`ON STOP` (613 customers) is the one that prevents a mistake: releasing goods to a stopped
account. `Cash` / `Credit`, `Counter` for a branch's own cash-sale account, and `National`
for accounts in scope everywhere.

## Result counts and the limit

The response reports how many matched, not only how many came back:

| Field | Meaning |
|---|---|
| `total` | rows actually returned |
| `matchCount` | rows that matched in total |
| `truncated` | `matchCount > total` |
| `limit` / `limitRequested` / `limitCapped` | the limit applied, what was asked for, and whether the ceiling bit |

When the page is truncated the component says so — *"25 of 2,169 matches — narrow the
search to see the rest"* — rather than reporting 25 as though it were the answer. Counting
costs ~0.9 ms over 2,169 matches, less than fetching the page itself.

`matchCountApproximate` is set only on the mixed postcode+name route, where the two searches
are counted separately and a customer matching both is counted twice. It is an upper bound
there, flagged rather than hidden.

**The ceiling is 500.** It exists so one search cannot ask for 39,000 rows, and asking for
more returns 500 with `limitCapped: true` — a silent clamp is indistinguishable from a bug,
which is how the original 100 was found.

## Data

`customer` + `customer_fts` (trigram) + `branch_quick_code` + `branch_neighbour`, served by
`GET /api/customers?q=&branch=&scope=&limit=`. Also
`GET /api/customers/quick-codes?branch=` for a branch's keypad.

Measured on 39,452 customers: quick code 0.08 ms, account-code prefix and postcode ~0.02 ms
(NOCASE indexes), name via trigram FTS ~1 ms including the join.

## Security

Everything here is a display filter. `scope` and `workingBranchId` arrive from the browser,
so the server must re-check on any write. Showing a customer is not authorising a sale to
them.

## Changelog

### 0.1.0 — 2026-08-03

Initial version, against the `branch_quick_code` and `branch_neighbour` tables generated in
datagenerator2. All four routes, branch/neighbour/all scoping with national accounts always
included, keyboard selection, and owning-branch marking on rows from outside the working
branch.
