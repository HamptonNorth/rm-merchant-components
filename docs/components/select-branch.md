# select-branch

`<merchant-select-branch>` — pick a branch from the network.

## Current version: 0.1.0

## Usage

```html
<script type="module" src="/src/components/select-branch/select-branch.js"></script>

<merchant-select-branch
  selected-id="13"
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
| `merchant-branch-selected` | `{ id, code, name, isHome }` | A branch is clicked. Bubbles and crosses the shadow boundary. |

`isHome` is always `false` at v0.1.0; it becomes meaningful at v0.2.0.

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

### 0.1.0 — 2026-08-01

Initial version, and the Phase 0 stack proof (docs/plan.md §8). Branches grouped by
region, selectable, with code, name, address, postcode and telephone. Loading skeleton,
error state with retry, and empty state. Region-grouped responsive grid driven by
container queries, so it reflows to the width of its container rather than the viewport.

Known limitation: no `customerId` property yet, so `isHome` is always `false`.

### 0.2.0 — planned (Phase 1)

Add `customerId`; pin and mark `customer.home_branch_id` at the top of the list and set
`isHome` correctly in the event detail.
