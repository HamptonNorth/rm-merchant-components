// server/app.js — Hono app: the JSON API, the component modules, and the harness pages.
//
// URL paths deliberately mirror filesystem paths (/src/... and /client/...), so a relative
// import resolves identically on disk and over HTTP. That is what lets the client run
// unbundled with no watch step (docs/plan.md §5) while `bun run check` can still validate
// every import by bundling the same files from disk.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { branches, appUsers } from "./routes/branches.js";
import { customers } from "./routes/customers.js";
import { credit } from "./routes/credit.js";
import { delivery } from "./routes/delivery.js";
import { userPermissions } from "./routes/permissions.js";
import { harness } from "./routes/harness.js";
import { dbPath, isDev } from "./db.js";

export const app = new Hono();

const api = new Hono();
api.route("/branches", branches);
api.route("/customers", customers);
api.route("/customers", credit);
api.route("/customers", delivery);
api.route("/app-users", appUsers);
api.route("/app-users", userPermissions);
api.route("/harness", harness);
api.get("/", (c) => c.json({ name: "rm-merchant-components", dbPath, dev: isDev }));

app.route("/api", api);
app.notFound((c) =>
  c.req.path.startsWith("/api/") ? c.json({ error: "not found", path: c.req.path }, 404) : page(c),
);

// Component source, the generated stylesheet, the harness and the vendored Lit bundle —
// each served at its own path on disk.
app.use("/src/*", serveStatic({ root: "./" }));
app.use("/client/*", serveStatic({ root: "./" }));

async function file(path, type) {
  const f = Bun.file(path);
  if (!(await f.exists())) return null;
  return new Response(f, { headers: { "content-type": type } });
}

// Both harness pages are static HTML; the component page reads its id from the path.
async function page(c) {
  const path = c.req.path;
  if (path === "/" || path === "/index.html") {
    return (await file("./client/index.html", "text/html; charset=utf-8")) ?? built(c);
  }
  if (path.startsWith("/c/")) {
    return (await file("./client/component.html", "text/html; charset=utf-8")) ?? built(c);
  }
  if (path.startsWith("/f/")) {
    return (await file("./client/flow.html", "text/html; charset=utf-8")) ?? built(c);
  }
  return c.text("Not found", 404);
}

function built(c) {
  return c.text("Client not built — run `bun run build` first.", 503);
}

app.get("/", page);
app.get("/c/:id", page);
app.get("/f/:id", page);
