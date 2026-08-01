# select-branch

`<merchant-select-branch>` — which branch for this piece of work?

## Current version: 0.2.0

Order-taking branch, issuing branch, transfer destination — a considered choice, which is
why it shows addresses and contact details.

**Not the picker for "where am I working today"** — that is
[`working-branch`](working-branch.md), a compact dropdown driven by
`app_user.default_branch_id`. See docs/plan.md §0 for why ownership and location are
different relationships.

## Usage

```html
<script type="module" src="/src/components/select-branch/select-branch.js"></script>

<merchant-select-branch
  selected-id="13"
  allowed-codes="01,02,31"
  heading="Select a branch"
  show-contact
></merchant-select-branch>
```

```js
document.querySelector("merchant-select-branch")
  .addEventListener("merchant-branch-selected", (e) => {
    console.log(e.detail); // { id, code, name, isHome }
  });
```

## Properties

| Property | Attribute | Type | Default | Notes |
|---|---|---|---|---|
| `allowedCodes` | `allowed-codes` | string[] \| null | `null` | Restrict to these branch codes. Comma-separated in the attribute, a real array in JS. Display filter only — see Security. |
| `regionId` | `region-id` | number \| null | `null` | Show only branches in this region id. Blank shows all 8 regions. |
| `selectedId` | `selected-id` | number \| null | `null` | Branch id to mark as selected. Also set internally on click. |
| `heading` | `heading` | string | `"Select a branch"` | Blank hides the heading. |
| `dense` | `dense` | boolean | `false` | Tighter rows, no address or contact lines. |
| `showContact` | `show-contact` | boolean | `true` | Telephone under each branch. Ignored when `dense`. |
| `api` | — | object | default HTTP client | Injected API implementation. |
| `apiBase` | `api-base` | string | `""` | Prefix for API URLs when the component is hosted elsewhere. |

## Events

| Event | Detail | When |
|---|---|---|
| `merchant-branch-selected` | `{ id, code, name, isCustomerHome }` | A branch is clicked. Bubbles and crosses the shadow boundary. |

`isCustomerHome` is always `false` until v0.3.0. It refers to the branch that **owns** the
customer (`customer.home_branch_id` — prices, credit limit), not anyone's physical
location.

## Security

`allowedCodes` is a **display filter, not authorisation** — it arrives from the browser.
Real permissions must be resolved server-side from the session user once the
role × user × branch matrix exists (docs/plan.md §7.7).

## Styling

Shadow DOM, so host CSS cannot reach inside. Two supported routes:

- **Custom properties** (inherit through the boundary): `--merchant-accent`,
  `--merchant-accent-soft`, `--merchant-radius`, `--merchant-font`.
- **Parts**: `root`, `heading`, `group`, `branch`, `branch-selected`, `loading`, `empty`,
  `error`.

```css
merchant-select-branch {
  --merchant-accent: #b45309;
}
merchant-select-branch::part(branch-selected) {
  outline: 2px solid currentColor;
}
```

Dark mode follows `data-theme="dark"` on the element or any ancestor.

## Data

`branch` left-joined to `region` — 28 branches, 8 regions. Served by
`GET /api/branches?region=`. No paging: the whole network fits on one screen and the
query measures ~0.3 ms.

## Changelog

### 0.2.0 — 2026-08-01

Added `allowedCodes` to restrict the list to specific branch codes, with codes that are
not in the dataset reported explicitly rather than silently dropped — a typo in an access
list otherwise looks like a permissions problem.

Renamed the event detail field `isHome` → `isCustomerHome`. It has only ever emitted
`false`, so this is free now and would be a breaking change once either branch component
carries a real value. The rename removes a genuine ambiguity: with `working-branch` now
existing, "home" could mean either the customer's owning branch or the user's default.

Scope clarified: this component answers "which branch for this work", not "where am I
working" — the latter moved to the new `working-branch` component.

### 0.1.0 — 2026-08-01

Initial version, and the Phase 0 stack proof (docs/plan.md §8). Branches grouped by
region, selectable, with code, name, address, postcode and telephone. Loading skeleton,
error state with retry, and empty state. Region-grouped responsive grid driven by
container queries, so it reflows to the width of its container rather than the viewport.

Known limitation: no `customerId` property yet, so `isHome` is always `false`.

### 0.3.0 — planned (Phase 1)

Add `customerId`; pin and mark the customer's owning branch (`customer.home_branch_id`) at
the top of the list and set `isCustomerHome` correctly in the event detail. Was numbered
0.2.0 before `allowedCodes` took that release.
