# working-branch

`<merchant-working-branch>` — which branch is this member of staff operating from?

## Current version: 0.1.0

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
| `merchant-working-branch-changed` | `{ id, code, name, isDefault, userId, cause }` | On preselect and on change. |

`cause` is `"default"` when the component preselected on load, `"user"` when a person
chose. A host persisting working context should generally only write on `"user"`.

Auto-selection only fires when the user's default branch is actually in the permitted
list — a rep whose default branch was revoked is not silently placed there.

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

`allowedCodes` is a **display filter, not authorisation** — it arrives from the browser.
Real permissions must be resolved server-side from the session user once the
role × user × branch matrix exists (docs/plan.md §7.7). `listBranchesForUser()` in
`server/queries/branches.js` is the single seam that change goes through; no component
change is needed.

## Data

`app_user` joined to `app_role` and `branch`, plus the branch list. Served by
`GET /api/app-users/:id/branches?codes=`. Today every user is permitted every branch
because the dataset has no user→branch access table — all 175 `app_user` rows carry
exactly one `default_branch_id` and nothing else.

## Styling

Parts: `root`, `heading`, `select`, `notice`, `user`, `loading`, `empty`, `error`.
Custom properties: `--merchant-accent`, `--merchant-radius`, `--merchant-font`.
Dark mode follows `data-theme="dark"` on the element or any ancestor.

## Changelog

### 0.1.0 — 2026-08-01

Initial version. Split out of `select-branch` rather than added to it as a `format`
property, because the employee and transaction cases differ in data source, default,
cardinality and a11y model — not just presentation (docs/plan.md §9).
