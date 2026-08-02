# user-permissions-view

`<merchant-user-permissions-view>` — what am I allowed to do, and where?

## Current version: 0.1.0

Written for the person the permissions belong to, not for an administrator auditing them.
The eventual entry point is the account button: a member of staff clicks their own name and
reads this. So: plain wording, no permission codes, no ids, no "denied" rows.

The hard part is volume. A counter assistant holds 4 grants; a head office user holds 432
across 29 branches. Both have to read well.

## Usage

```html
<script type="module" src="/src/components/user-permissions-view/user-permissions-view.js"></script>

<merchant-user-permissions-view user-id="47"></merchant-user-permissions-view>
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
| `dense` | `dense` | boolean | `true` | Collapse branches to ranges. Off lists every branch. |
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

### 0.1.0 — 2026-08-02

Initial version, against the `app_user_branch` / `app_user_permission` tables added to
datagenerator2 the same week.
