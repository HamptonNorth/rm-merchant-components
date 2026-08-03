# user-permissions-view

`<merchant-user-permissions-view>` — what am I allowed to do, and where?

## Current version: 0.2.0

Written for the person the permissions belong to, not for an administrator auditing them.
The eventual entry point is the account button: a member of staff clicks their own name and
reads this. So: plain wording, no permission codes, no ids, no "denied" rows.

The hard part is volume. A counter assistant holds 4 grants; a head office user holds 432
across 29 branches. Both have to read well.

## Two modes

Which one you get depends on whether `workingBranchId` is set.

**Scoped** — the everyday path, after the sign-in gate has established a working branch.
The card answers *what can I do here*: permissions at that branch only, with limits, and no
branch labels down the rows because there is only one branch in view. Other branches move
behind a "You also have permissions at 8 other branches" link.

**Whole profile** — `workingBranchId` unset, the v0.1.0 behaviour, unchanged. Every branch,
with ranges collapsed ("All 4 North West branches"). This is what an admin screen reviewing
someone's access wants.

The count in the header follows the mode: scoped it reads "3 of 15 permissions **here**".
Showing "15 of 15" while standing at a branch where only 3 of them work would be the same
class of misstatement as flagging every non-default branch as a warning.

## Usage

```html
<script type="module" src="/src/components/user-permissions-view/user-permissions-view.js"></script>

<!-- After the sign-in gate: what can I do at the branch I am working from? -->
<merchant-user-permissions-view user-id="47" working-branch-id="2">
</merchant-user-permissions-view>

<!-- Admin screen: the whole profile across every branch. -->
<merchant-user-permissions-view user-id="47"></merchant-user-permissions-view>
```

Wiring it to the working-branch picker is the host application's job (docs/plan.md §0):

```js
workingBranch.addEventListener("merchant-working-branch-changed", (e) => {
  permissionsCard.workingBranchId = e.detail.id;
});
```

```js
document.querySelector("merchant-user-permissions-view")
  .addEventListener("merchant-user-permissions-loaded", (e) => {
    // { userId, branchCount, permissionCount, grantCount }
  });
```

## Properties

| Property | Attribute | Type | Default | Notes |
|---|---|---|---|---|
| `userId` | `user-id` | number \| null | `null` | The `app_user` whose permissions these are. |
| `workingBranchId` | `working-branch-id` | number \| null | `null` | The branch chosen at sign-in. Set, the card scopes to it. Blank shows the whole profile. |
| `expanded` | `expanded` | boolean | `false` | Open the other-branches section. Only appears when scoped and the user covers more than one branch. |
| `dense` | `dense` | boolean | `true` | Collapse branches to ranges. Off lists every branch. Hidden when scoped — one branch has nothing to collapse. |
| `heading` | `heading` | string | `"Your permissions"` | Card heading. Blank hides it. |
| `showDescriptions` | `show-descriptions` | boolean | `true` | The one-line explanation under each permission name. |

`dense` and `showDescriptions` default to `true` and are ordinary HTML boolean attributes, so
presence is what counts — `dense="false"` is still true. Turn them off from JS
(`el.dense = false`), which is what the harness does.

## Events

| Event | Detail | When |
|---|---|---|
| `merchant-user-permissions-loaded` | `{ userId, branchCount, permissionCount, grantCount }` | After each successful fetch. |
| `merchant-user-permissions-density-changed` | `{ userId, dense }` | When someone uses the toggle. |
| `merchant-user-permissions-expanded` | `{ userId, workingBranchId, expanded }` | When the other-branches section is opened or closed. |

## Other branches

Expanding groups the user's other branches **by what they can do at each**, not one section
per branch.

One section per branch is the obvious reading, and it fails at the top end: a head office
user covers 29 and would get 28 near-identical blocks — the wall this card exists to avoid.
In the generated data the largest number of *distinct* permission sets any user has is
**five**, and 26 of the 37 multi-branch users have exactly two. So grouping turns 28
sections into two or three.

A group identical to the working branch is named and left at that:

> Newcastle-upon-Tyne, Sheffield and Darlington — same as Leeds

Repeating fifteen identical permissions under each heading answers nothing that "same as
here" does not. A group that differs lists its permissions and limits in full, which is what
someone needs when their own branch is busy and they are deciding where to send the work.

Branch names use the same range collapsing as the whole-profile view, so a whole region
reads as "All 4 North West branches".

## How rows collapse

Three rules, all in `src/components/shared/permissions.js` and tested without a DOM in
`test/permissions.test.js`.

**Group by permission _and_ limit.** A travelling rep may raise credit notes up to £600 at
their home branch and £300 away. That is two facts, not one, and merging them would state
something false:

```
Raise credit note
  £550   Bristol
  £250   Exeter
```

**Describe branches by region, with exceptions.** In order of preference:

| Held | Reads as |
|---|---|
| every branch covered, 1–2 of them | `Chester and Warrington` |
| every branch covered, 3+ | `All 29 branches` |
| exactly one region | `All 4 North West branches` |
| a region plus stragglers | `All 3 North West branches and Sheffield` |
| all but one or two | `All branches except East London` |
| anything else | the branches, named |

The region form wins over the exception form while the phrase stays tidy — at most two
clauses and at most two named branches. A head office user holding a permission at 28 of 29
branches decomposes into seven whole regions and four stragglers, which nobody reads; *All
branches except East London* is the same fact in five words.

Nothing is ever truncated. A card that hides where a permission applies is worse than a long
line, so a messy remainder is spelled out rather than summarised as "and 6 more".

A region phrase means the whole region *in the network*, not merely the part of it the user
covers — the coverage query carries `region_branch_count` for exactly this. Nigel Dodds covers
2 of the Midlands' 3 branches and reads as "Birmingham and Northampton"; "All 2 Midlands
branches" would state something false.

**Categories with nothing held are absent, not empty.** Showing "Purchasing — none" to a
counter assistant is noise, and greying out what they cannot do invites "how do I get that?",
which this card cannot answer.

## Density

The toggle changes density only, never structure — a row does not move when it is switched.
It is hidden entirely for single-branch users, where there is nothing to collapse; those
users also lose the branch column, since the branch is in the header and cannot be anywhere
else. An unlimited permission at a single branch is then just its name.

## Approval limits

`approval_limit_pence` is a **threshold, not a ceiling**: above the figure the transaction is
sent for approval, it is never refused. The card says so in a footnote whenever a limited
permission is on screen.

| Value | Shown as |
|---|---|
| `permission.is_limited = 0` | nothing — the concept does not apply |
| a figure | `£2,500` |
| `NULL` on a limited permission | `No approval needed` |

Limits are round £50 figures upstream, so whole pounds always reads correctly.

## Data

`app_user` → `app_user_branch` → `app_user_permission` → `permission`, joined to `branch`,
`region` and `app_role`. Served by `GET /api/app-users/:id/permissions` in one call: identity,
coverage, grants and the full 15-row catalogue (used only for the "12 of 15 permissions"
summary).

Flat rows cross the wire and the component collapses them, rather than the server shaping a
nesting the component would have to flatten again to group differently. The largest response
is 432 grants and takes under a millisecond — `app_user_permission` is one of the four indexed
tables in the dataset.

A grant row existing means the permission is held; there are no deny rows. See
datagenerator2 `docs/requirements-permissions.md`.

Users **158** and **159** are hand-specified upstream rather than generated, so their branch
sets do not move when the seed changes — they are the fixtures to test branch behaviour
against, and both appear in the harness. See datagenerator2 `docs/CAVEATS.md`.

## Security

This renders what the server returns for the id it is given. It is a **display of**
permissions, not an enforcement of them — `userId` arrives from the browser, so nothing here
is an authorisation boundary. Once sessions exist, the id should come from the session rather
than an attribute, which is a change to `server/routes/permissions.js` only.

## Styling

Parts: `root`, `header`, `heading`, `dense-toggle`, `category`, `category-heading`,
`permission`, `scope`, `limit`, `legend`, `loading`, `empty`, `error`.
Custom properties: `--merchant-accent`, `--merchant-radius`, `--merchant-font`.
Dark mode follows `data-theme="dark"` on the element or any ancestor.

## Changelog

### 0.2.0 — 2026-08-03

Added `workingBranchId`, making the card answer "what can I do *here*" once the sign-in gate
has established a working branch. Other branches move behind a disclosure, grouped by what
the user can do at each rather than one section per branch — 28 sections for a head office
user would be the wall the card was built to avoid, and no user in the dataset has more than
five distinct permission sets.

Scoping needed almost no special-casing: filtering `coverage` to one branch is what already
made `renderPermission` drop the per-row branch label and `isCollapsible` hide the density
toggle.

Unset, the card behaves exactly as at 0.1.0 — the whole profile with ranges collapsed —
which is what an admin screen wants.

Scoped to a branch the user does not cover, both the header and the body say so, rather than
falling back to the whole profile. Silently widening would tell someone standing at a branch
they cannot work from that they hold fifteen permissions.

### 0.1.0 — 2026-08-02

Initial version, against the `app_user_branch` / `app_user_permission` tables added to
datagenerator2 the same week.
