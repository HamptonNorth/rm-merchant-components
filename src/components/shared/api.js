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

    listScenarios: ({ component } = {}) => get("/api/harness/scenarios", { component }),
    dataset: () => get("/api/harness/dataset"),
  };
}
