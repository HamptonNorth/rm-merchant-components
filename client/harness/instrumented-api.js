// client/harness/instrumented-api.js — wraps the real API client to build the request log.
//
// Wrapping the injected `api` object rather than patching window.fetch means the log
// records exactly the calls the component made, with the server's timing and query plan
// already in the response envelope (docs/plan.md §6, §7.4).

export function instrumentApi(api, onCall) {
  const wrapped = {};
  for (const [name, fn] of Object.entries(api)) {
    if (typeof fn !== "function") continue;
    wrapped[name] = async (...args) => {
      const startedAt = new Date();
      try {
        const result = await fn(...args);
        onCall({
          method: name,
          args,
          url: result?.url ?? "",
          status: result?.status ?? 200,
          clientMs: result?.clientMs ?? null,
          tookMs: result?.tookMs ?? null,
          rows: result?.total ?? result?.rows?.length ?? null,
          plan: result?.plan ?? [],
          warnings: result?.warnings ?? [],
          at: startedAt,
          ok: true,
        });
        return result;
      } catch (err) {
        onCall({
          method: name,
          args,
          url: err?.url ?? "",
          status: err?.status ?? 0,
          error: err?.message ?? String(err),
          at: startedAt,
          ok: false,
          plan: [],
          warnings: [],
        });
        throw err;
      }
    };
  }
  return wrapped;
}
