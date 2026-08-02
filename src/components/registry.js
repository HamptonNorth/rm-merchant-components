// src/components/registry.js — the single manifest (docs/plan.md §4).
//
// The harness index and the component pages both read this, so adding a component means
// one entry here and one directory alongside. `version` is bumped by hand on every
// behaviour change and is displayed as a badge in the harness; the changelog lives in
// docs/components/<id>.md.
//
// status:  ready    built and usable
//          planned  specced in docs/plan.md, not yet built
//          blocked  cannot be completed until an upstream dependency lands

export const components = [
  {
    id: "working-branch",
    tag: "merchant-working-branch",
    title: "Working branch",
    version: "0.1.0",
    status: "ready",
    phase: 0,
    group: "Staff",
    description:
      "Which branch a member of staff is operating from. Compact dropdown, preselected to their app_user.default_branch_id — the sign-in behaviour — and restricted to the branches they may cover.",
    dataDeps: ["app_user", "app_role", "branch", "region"],
    module: "/src/components/working-branch/working-branch.js",
    events: ["merchant-working-branch-changed"],
  },
  {
    id: "user-permissions-view",
    tag: "merchant-user-permissions-view",
    title: "User permissions",
    version: "0.1.0",
    status: "ready",
    phase: 0,
    group: "Staff",
    description:
      "What one member of staff may do, and where — grouped by category, with approval thresholds. Branches collapse to ranges (\"All 4 North West branches\") where the permission and limit match. Behind the future account button.",
    dataDeps: ["app_user", "app_role", "app_user_branch", "app_user_permission", "permission", "branch", "region"],
    module: "/src/components/user-permissions-view/user-permissions-view.js",
    events: ["merchant-user-permissions-loaded", "merchant-user-permissions-density-changed"],
  },
  {
    id: "select-branch",
    tag: "merchant-select-branch",
    title: "Select branch",
    version: "0.2.0",
    status: "ready",
    phase: 0,
    group: "Customer",
    description:
      "Which branch for a piece of work — order-taking, issuing, transfer. Card grid grouped by region with addresses, optionally restricted to a list of branch codes. v0.3.0 pins the customer's owning branch.",
    dataDeps: ["branch", "region"],
    module: "/src/components/select-branch/select-branch.js",
    events: ["merchant-branch-selected"],
  },
  {
    id: "find-customer",
    tag: "merchant-find-customer",
    title: "Find customer",
    version: "0.1.0",
    status: "planned",
    phase: 1,
    group: "Customer",
    description:
      "Debounced type-ahead over name, account code, postcode and town, filtered by branch, status and account type.",
    dataDeps: ["customer", "branch", "sales_rep"],
    events: ["merchant-customer-selected"],
  },
  {
    id: "credit-status",
    tag: "merchant-credit-status",
    title: "Check credit status",
    version: "0.1.0",
    status: "planned",
    phase: 1,
    group: "Customer",
    description:
      "Limit, outstanding, headroom and ageing buckets, plus a paged drill-down list of unpaid and recent invoices.",
    dataDeps: ["customer", "aged_debt", "branch"],
    events: ["merchant-credit-checked", "merchant-invoice-selected"],
  },
  {
    id: "delivery-address",
    tag: "merchant-delivery-address",
    title: "Select delivery address",
    version: "0.1.0",
    status: "planned",
    phase: 1,
    group: "Customer",
    description:
      "Delivery addresses for a customer with project reference, unload method, instructions and what3words.",
    dataDeps: ["customer_delivery_address"],
    events: ["merchant-delivery-address-selected"],
  },
  {
    id: "product-detail",
    tag: "merchant-product-detail",
    title: "Show product details",
    version: "0.1.0",
    status: "planned",
    phase: 2,
    group: "Product",
    description:
      "Full product card including the price tier matrix per unit of measure, quantity breaks, dimensions and default supplier.",
    dataDeps: ["product", "product_price", "price_break_tier", "unit_of_measure", "tax_rate"],
    events: ["merchant-product-price-selected"],
  },
  {
    id: "find-product",
    tag: "merchant-find-product",
    title: "Find product(s)",
    version: "0.1.0",
    status: "planned",
    phase: 2,
    group: "Product",
    description:
      "Search by code, name or barcode, faceted by product-group subtree, supplier and unit-of-measure type.",
    dataDeps: ["product", "product_group", "supplier"],
    events: ["merchant-products-selected"],
  },
  {
    id: "find-supplier",
    tag: "merchant-find-supplier",
    title: "Find supplier",
    version: "0.1.0",
    status: "planned",
    phase: 2,
    group: "Product",
    description: "Search the 26 suppliers by code, name or town, with a supplied-product count.",
    dataDeps: ["supplier", "product"],
    events: ["merchant-supplier-selected"],
  },
  {
    id: "stock-check",
    tag: "merchant-stock-check",
    title: "Stock check for product",
    version: "0.1.0",
    status: "blocked",
    phase: 3,
    group: "Stock",
    description:
      "On hand, allocated, free, on order with ETA, bin location and reorder levels for one product at one branch.",
    dataDeps: ["stock"],
    blockedBy: "datagenerator.db has no stock table — see docs/plan.md §7.1",
    events: ["merchant-stock-checked"],
  },
  {
    id: "multi-branch-stock",
    tag: "merchant-multi-branch-stock",
    title: "Multi-branch stock availability",
    version: "0.1.0",
    status: "blocked",
    phase: 3,
    group: "Stock",
    description:
      "One product across all 28 branches, grouped by region, with a network total and nearest-with-stock highlighting.",
    dataDeps: ["stock", "branch", "region"],
    blockedBy: "datagenerator.db has no stock table — see docs/plan.md §7.1",
    events: ["merchant-branch-stock-selected"],
  },
];

export function byId(id) {
  return components.find((c) => c.id === id) ?? null;
}

// Declaration order, so "Staff" leads — these are staff tools, not customer-facing
// (docs/plan.md §0).
export const groups = [...new Set(components.map((c) => c.group))];
