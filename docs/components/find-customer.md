# find-customer

`<merchant-find-customer>` — one text box at the trade counter.

## Current version: 0.2.0

The same box has to sell a 50p bolt for cash and 20 pallets of bricks on a credit account,
so it routes on what was typed rather than making anyone pick a search mode first.

## Routing

| Input | Route | Example |
|---|---|---|
| a single digit `1`–`9` | that branch's quick code — one cash account | `1` → *Cash Sale — Stockport* |
| the dataset's account-code shape | account code prefix | `CA/000` |
| 3+ chars starting letter(s) then a digit | postcode, **and** name | `SK4`, `SK4 1`, `SK41DR` |
| 4+ chars otherwise | name, then address | `arrowsmith`, `gate build`, `Stead Lane` |

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

### Abbreviations, suffixes and spelling variants

Three problems that look alike and need different treatment. Measured on the dataset:

**Legal forms — `Ltd` / `Limited` / `Co` / `plc` — are never required.** 18,896 customers are
spelled "Limited" against 16,387 "Ltd"/"Ltd.", with 10,576 carrying no legal form at all.
Because tokens are ANDed, typing `ltd` used to **exclude** every "Limited" record: a search
went from 34 results to 11 by adding a word. A synonym pair would not have been enough
either, since a third of customers have no suffix to be equivalent to. So these words stop
being required and only influence ranking — `smith ltd` puts an actual "Smith Ltd" above a
"Smith Limited", and finds both.

Searching *only* a legal form still requires it, or the query would match everything.

**Mc / Mac find each other**, generated from the token rather than listed, so McPherson,
McBride and MacLeod all work without an entry each.

**Street types match both ways** — `Lane`/`Ln`, `Road`/`Rd`, `Avenue`/`Ave`. Substring
matching gets one direction free (`ave` sits inside "Avenue") but not the other (`rd` is
nowhere inside "Road"), so both are expanded.

These live as a **rule list in code, not a database table**: it is roughly twenty entries,
it is search behaviour rather than merchant data, and a table would have to live upstream in
datagenerator2 and need a regeneration to edit. If it grows past a few dozen, or a merchant
wants to edit it without a deploy, that judgement changes.

**Known limitation:** only leading and trailing punctuation is stripped from a token, so
`N.R.` keeps its inner dot. Typing `NR Willis` does not find "N.R. Willis" — fixing that
means normalising punctuation in the FTS index, which is built upstream.

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

### Did-you-mean, for when the spelling is wrong

Trigram substring matching is unforgiving: one transposed letter takes `builders` from 1,450
matches to **nought**. Every one of `buidlers`, `bulders`, `buillders`, `builers` returned
nothing before this.

So when a search finds nothing at all, the closest names are offered instead, ranked by
trigram similarity and labelled `matched_on: "similar"` with a `similarity` score. The UI
says **"no exact match — closest names"** rather than presenting guesses as matches.

**It only runs on a zero-result search**, and that is what makes it safe. The usual objection
to fuzzy matching — that it trades precision for recall — does not apply when there is
nothing on screen to dilute. It cannot make a good result worse because it never runs
alongside one. A test pins that.

| typed | found |
|---|---|
| `buidlers` | Hindley Builders Co. Ltd. |
| `biulders` | SLP Builders Co. Ltd. |
| `arowsmith` | K.W. Arrowsmith Co. Ltd. |
| `smiht` | Paul Smith |
| `zzzznothing` | nothing — a term resembling nothing still returns nothing |

Two things were tried and rejected:

- **Shortening the term to a prefix** is cheaper and not good enough. It recovers a dropped
  letter, but an early transposition (`biulders` → `biu`) finds one confidently *wrong*
  customer, which is worse than finding none.
- **Overlap over the longer set** (`shared / max`) ranked "Sharon Smith" above "K.W.
  Arrowsmith Co. Ltd." for `arowsmith`, penalising a long name for being long. **Dice**
  (`2·shared / (a+b)`) got all four test typos right where that got two wrong.

Cost is ~15 ms branch-scoped and ~115 ms across all 39,452 — acceptable because it only
fires when the fast paths have already failed.

### Address is its own route

`Stead Lane` finds the customers on it, labelled `matched_on: "address"` so a match on the
street somebody is standing on is never confused with a match on the company name.

It runs **only when the cheaper routes have not filled the page**. Address is a `LIKE` scan
over `address_1`/`address_2` — 3.4 ms worst case against 0.06 ms for the FTS name search —
so for a common term like `builders` it would cost that to add nothing. A test pins that it
stays out of the way.

At this size the scan is affordable; at ~400k customers it becomes ~34 ms, and the columns
want adding to `customer_fts` upstream. Recorded in `docs/upstream-requests.md`.

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
| `collapseOnSelect` | `collapse-on-select` | boolean | `false` | Hide the results once a customer is chosen. See below. |
| `dense` | `dense` | boolean | `false` | Tighter rows — 49 px against 59 px, about a third more on screen. |
| `zebra` | `zebra` | boolean | `false` | Alternating row shading. See below. |
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

## Collapsing after a choice

`collapseOnSelect` hides the result list once a customer is picked and shows the choice in
its place, with a **Change** link. Off by default.

The distinction is what the screen is for. In a sequence — the counter-sale flow — the search
has done its job the moment a customer is chosen, and leaving twenty-five other builders on
screen invites a second, wrong click on the way down the page. On the component page, where
browsing and comparing is the point, the list stays.

The typed term survives the collapse, so **Change** re-opens the same results rather than
making anyone retype. Typing again also re-opens it: the collapse is a resting state, not a
lock.

## Density and zebra

`dense` takes a row from 59 px to 49 px, which is roughly a third more results without
scrolling. Both lines of a record stay — the account code, name and badges on the first, the
town, postcode and owning branch on the second.

`zebra` is **off by default**, and the reason is worth recording because the first attempt at
it was actively harmful. This is a keyboard-driven list where Enter acts on the highlighted
row, so that highlight has to be unambiguous. Shading alternate rows at
`dark:bg-slate-800/40` put them within a shade of the active row's own background, and in
dark mode the selected row became impossible to pick out — every other row looked equally
selected.

Two changes make zebra safe rather than removing it:

- **The selected row carries an accent bar down its left edge**, not just a background tint.
  That reads at a glance whatever is behind it, and it improves the non-zebra case too.
- **The stripe is much fainter** (`bg-slate-500/5`), enough to bind the two lines of one
  record together without competing for attention.

Turn it on with `dense`, where rows are close enough that a record can run into its
neighbour. At comfortable spacing the border and whitespace already do that job.

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

### 0.2.0 — 2026-08-04

Added `collapseOnSelect`, `dense` and `zebra`. Added `matchCount` / `truncated` reporting so
a truncated page is never shown as though it were the whole answer, and raised the API
ceiling from 100 to 500 with the cap reported rather than applied silently. Name search now
matches part-words in any order, scoped to the name column.

### 0.1.0 — 2026-08-03

Initial version, against the `branch_quick_code` and `branch_neighbour` tables generated in
datagenerator2. All four routes, branch/neighbour/all scoping with national accounts always
included, keyboard selection, and owning-branch marking on rows from outside the working
branch.
