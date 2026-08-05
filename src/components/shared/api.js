// src/components/shared/api.js — the default HTTP client.
//
// Components never call fetch directly and never hardcode a URL; they call methods on an
// injected `api` object (docs/plan.md §3). The harness swaps in an instrumented wrapper to
// build its request log, and the stock components will swap in a fixture implementation
// until the upstream table lands (§7.6) — neither needs the component to change.

export class ApiError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export function createApi({ base = "" } = {}) {
  async function get(path, params) {
    const url = new URL(base + path, globalThis.location?.origin ?? "http://localhost");
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }

    const started = performance.now();
    let res;
    try {
      res = await fetch(url);
    } catch (cause) {
      throw new ApiError(`Could not reach ${url.pathname} — is the server running?`, {
        url: url.pathname,
      });
    }
    const clientMs = Number((performance.now() - started).toFixed(2));

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(body?.error ?? `Request failed (${res.status})`, {
        status: res.status,
        url: url.pathname + url.search,
        body,
      });
    }
    return { ...body, url: url.pathname + url.search, status: res.status, clientMs };
  }

  const csv = (v) => (Array.isArray(v) ? v.join(",") : v);

  return {
    listBranches: ({ regionId, codes } = {}) =>
      get("/api/branches", { region: regionId, codes: csv(codes) }),
    listRegions: () => get("/api/branches/regions"),

    // The employee's operating context: identity, default branch, permitted branches.
    listBranchesForUser: ({ userId, codes } = {}) =>
      get(`/api/app-users/${userId}/branches`, { codes: csv(codes) }),
    listAppUsers: ({ limit } = {}) => get("/api/app-users", { limit }),

    // What this member of staff may do, and where. One call: identity, coverage, grants.
    getUserPermissions: ({ userId } = {}) => get(`/api/app-users/${userId}/permissions`),

    // Trade-counter customer search. `scope` is branch | neighbours | all.
    searchCustomers: ({ term, branchId, scope, limit } = {}) =>
      get("/api/customers", { q: term, branch: branchId, scope, limit }),
    listQuickCodes: ({ branchId } = {}) => get("/api/customers/quick-codes", { branch: branchId }),

    // Credit: the summary answers the question, the invoice list shows the working.
    getCreditSummary: ({ customerId, asOf } = {}) => get(`/api/customers/${customerId}/credit`, { asOf }),
    listInvoices: ({ customerId, view, band, sort, limit, offset, asOf } = {}) =>
      get(`/api/customers/${customerId}/invoices`, { view, band, sort, limit, offset, asOf }),

    listDeliveryAddresses: ({ customerId, includeArchived } = {}) =>
      get(`/api/customers/${customerId}/delivery-addresses`, { includeArchived: includeArchived ? 1 : "" }),

    // Catalogue search as seen from one branch. `scope` is branch | all — every row reports
    // its availability at that branch either way, which is what makes widening worth doing.
    searchProducts: ({ term, branchId, scope, groupPath, supplierId, limit, offset } = {}) =>
      get("/api/products", {
        q: term, branch: branchId, scope, group: groupPath, supplier: supplierId, limit,
        // 0 is a real offset; the query builder drops empty strings, not zeroes.
        offset: offset || undefined,
      }),
    listProductGroups: ({ branchId } = {}) => get("/api/products/groups", { branch: branchId }),
    listProductSuppliers: ({ branchId } = {}) => get("/api/products/suppliers", { branch: branchId }),
    getRangeSummary: ({ branchId } = {}) => get("/api/products/range-summary", { branch: branchId }),

    // The full card for one product, as seen from a branch — identity, price bands per unit,
    // dimensions, supply, and whether this branch may sell it.
    getProductDetail: ({ productId, branchId } = {}) =>
      get(`/api/products/${productId}`, { branch: branchId }),

    // What a quantity input needs: unit-of-measure config, price tiers, tally lengths.
    getQtyConfig: ({ productId } = {}) => get(`/api/products/${productId}/qty-config`),
    listTallies: () => get("/api/products/tallies"),

    listScenarios: ({ component } = {}) => get("/api/harness/scenarios", { component }),
    dataset: () => get("/api/harness/dataset"),
  };
}
