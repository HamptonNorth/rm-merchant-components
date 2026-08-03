# working-branch

`<merchant-working-branch>` — which branch is this member of staff operating from?

## Current version: 0.2.0

John Smith signs in at the Warrington counter and the system sets him to Warrington,
because that is his `app_user.default_branch_id`. A sales desk rep covering Liverpool and
Manchester switches between the branches they cover.

**This is not `select-branch`.** See docs/plan.md §0:

| | `working-branch` | `select-branch` |
|---|---|---|
| Question | Where am I working? | Which branch for this order/transfer? |
| Source | `app_user.default_branch_id` | the branch network |
| Nature | Session context, set once per shift | A considered per-transaction choice |
| Form | Compact dropdown, lives in header furniture | Card grid with addresses |

## Usage

```html
<script type="module" src="/src/components/working-branch/working-branch.js"></script>

<merchant-working-branch user-id="42" allowed-codes="01,03"></merchant-working-branch>
```

```js
document.querySelector("merchant-working-branch")
  .addEventListener("merchant-working-branch-changed", (e) => {
    // { id, code, name, isDefault, userId, cause }
    if (e.detail.cause === "user") persistWorkingBranch(e.detail.id);
  });
```

## Properties

| Property | Attribute | Type | Default | Notes |
|---|---|---|---|---|
| `userId` | `user-id` | number \| null | `null` | The signed-in `app_user`. Their `default_branch_id` is preselected. |
| `allowedCodes` | `allowed-codes` | string[] \| null | `null` | Branch codes this user may operate from. Comma-separated in the attribute; a real array in JS. |
| `selectedId` | `selected-id` | number \| null | `null` | Override the selection. Blank falls back to the user's default. |
| `heading` | `heading` | string | `"Working from"` | Label for the select. Blank hides it. |
| `showUser` | `show-user` | boolean | `true` | Show who is signed in, and their role. |

## Events

| Event | Detail | When |
|---|---|---|
| `merchant-working-branch-changed` | `{ id, code, name, isDefault, access, permissionCount, userId, cause }` | On preselect and on change. |

`access` is `"default"`, `"permitted"` or `"denied"` — see Access states below.

`cause` is `"default"` when the component preselected on load, `"user"` when a person
chose. A host persisting working context should generally only write on `"user"`.

Auto-selection only fires when the user's default branch is actually in the permitted
list — a rep whose default branch was revoked is not silently placed there.

## Access states

The notice under the control reports how the **selected** branch stands for this user,
tested on whether they hold any permissions there:

| `access` | Condition | Message | Tone |
|---|---|---|---|
| `default` | Their own branch | "Your default branch — 15 permissions here." | muted |
| `permitted` | Permissions held, but not their base | "Valid working branch, not your default (Chester) — 3 permissions here." | informational |
| `denied` | No permissions at all | "No permissions at this branch — you cannot work from here." | warning |

**Being away from your default branch is not a warning.** For anyone covering more than one
branch it is the ordinary case — a rep at Warrington instead of Chester is working, not
doing something irregular. Warning on it trains people to ignore the warning, so only
`denied` is styled as one.

The permission count is shown because coverage is not uniform: the same user can hold 15
permissions at their own branch and 3 at another. "Valid working branch" on its own would
hide that, in the same way that flagging every non-default branch hid the real problem.

`denied` cannot be reached through the dropdown, which only lists covered branches. It
arises when a host sets `selectedId` to something else — a working branch restored from a
stale session, or access revoked since. The select then shows a disabled "Branch not
available to you" entry so the control and the message agree.

## Behaviour

- Optgroups by region, but only when more than one region is in range; optgroups round a
  single region are noise.
- The default branch is labelled `(default)` in its option.
- Working away from the default shows a notice naming the default branch.
- Branch codes supplied but not present in the dataset are reported explicitly. Silently
  dropping them makes a typo in an access list look like a permissions problem.

A native `<select>` is used deliberately: keyboard, mobile and screen-reader behaviour all
come free, and this control lives in furniture where compactness matters. If the permitted
list ever outgrows a select, this becomes a combobox — a change confined to this component.

## Security

The branch list is resolved **server-side** from `app_user_branch`, so it is no longer
merely cosmetic. `allowedCodes` remains a display filter that can only narrow that list
further — it arrives from the browser and grants nothing.

What the component shows is still an affordance, not an authorisation boundary: the server
must re-check permissions on every write. A `denied` notice tells someone they cannot work
at a branch; it does not stop anything.

## Data

`app_user_branch` joined to `branch`, `app_role` and `region`, with a per-branch grant count
from `app_user_permission`. Served by `GET /api/app-users/:id/branches?codes=`, returning
`permission_count` per row plus `defaultBranchId` and `permittedFrom`.

`app_user_branch.is_default` is authoritative for the default branch;
`app_user.default_branch_id` is the denormalised fast path and the two must agree
(`docs/requirements-permissions.md` invariant 7). The component falls back to the latter
only when `allowedCodes` has filtered the default branch out of the list.

Head Office (`branch_type = 'head_office'`) has no region, so it is grouped under a "Head
office" optgroup and sorted last rather than landing in "Unassigned".

## Styling

Parts: `root`, `heading`, `select`, `notice`, `user`, `loading`, `empty`, `error`.
The notice also carries a state part — `access-default`, `access-permitted` or
`access-denied` — so a host can restyle a single state.
Custom properties: `--merchant-accent`, `--merchant-radius`, `--merchant-font`.
Dark mode follows `data-theme="dark"` on the element or any ancestor.

## Changelog

### 0.2.0 — 2026-08-03

Uses the permission model that landed in datagenerator2.

`listBranchesForUser()` now resolves the list from `app_user_branch` instead of returning
the whole network — the seam plan §7.7 said would close when the matrix arrived. A
Purchasing user covering four branches is offered four, not twenty-nine.

Replaced the "Not your default branch" warning with a three-state access notice keyed on
whether the user holds any permissions at the selected branch. The old message fired on
every non-default branch, which for anyone covering more than one is the ordinary case, and
said nothing about whether they could actually work there. Added `access` and
`permissionCount` to the event detail, and `access-*` parts for styling.

Reworded the unknown-codes notice from "Unknown branch code" to "Not among your branches",
since a code can now be absent because the user has no coverage there rather than because
it does not exist.

### 0.1.0 — 2026-08-01

Initial version. Split out of `select-branch` rather than added to it as a `format`
property, because the employee and transaction cases differ in data source, default,
cardinality and a11y model — not just presentation (docs/plan.md §9).
