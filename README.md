# rm-merchant-components

Builders' merchant UI components (Lit + Tailwind, shadow DOM) with a development harness,
served by Hono over the `datagenerator2` SQLite dataset. Plain JavaScript, no TypeScript.

Full design: [`docs/plan.md`](docs/plan.md).

## Quick start

```bash
bun install
bun run dev          # build + serve on http://localhost:8788 with --hot
```

## The dataset

Read **read-only, in place** from datagenerator2 — regenerate there and this project picks
it up on the next restart. There is never a reason to copy the file here; a copy is worse
than no copy, because a stale one looks exactly like a fresh one.

The location is resolved in this order, and the startup banner says which one won plus how
old the file is:

| | Where | Why |
|---|---|---|
| 1 | `MERCHANT_DB_PATH` | Explicit override. If set and absent, startup fails rather than quietly falling through. |
| 2 | datagenerator2's `sqlite_path` | Read from its `datagenerator.env`, so changing where it writes moves this project too. |
| 3 | `../datagenerator2/out/datagenerator.db` | The convention, if there is no config to read. |
| 4 | `./data/datagenerator.db` | A local copy, if one was made anyway. |

`MERCHANT_GENERATOR_DIR` points at datagenerator2 if it is not the sibling directory.

```bash
MERCHANT_DB_PATH=/path/to/datagenerator.db bun run dev
```

A copy in `./data` that is not the file being read is reported at startup and on the
harness index, because it is either already out of date or one regeneration away from it.

## Scripts

| Script | Does |
|---|---|
| `bun run dev` | Build, then serve with hot reload |
| `bun run build` | `vendor` + `css` |
| `bun run css` / `css:watch` | Tailwind → light-DOM stylesheet + shadow-DOM `CSSResult` |
| `bun run vendor` | Bundle the installed Lit to `client/vendor/lit.js` |
| `bun run check` | Bundle every client entry point to catch bad imports and syntax errors |
| `bun run explain` | Time a query and test candidate indexes on a scratch DB copy |

If the port is busy the server names the process holding it and prints the command to free
it. `PORT=8789 bun run dev` moves it instead. One warning it repeats, because it has cost
real time here: **do not use `pkill -f server/index.js`** — `pkill -f` matches against full
command lines, and the shell running it has the pattern in its own, so it kills your own
terminal. Target the port (`fuser -k 8788/tcp`), not the command name.

Build output (`src/styles/tailwind.css*`, `client/vendor/`) is generated and gitignored.

## Layout

```
server/      Hono app — API routes, query modules, the readonly DB handle
src/
  components/
    shared/          MerchantElement base, API client, formatters
    <id>/<id>.js     one directory per component
    registry.js      the manifest the harness reads
  styles/            Tailwind entry + generated output
client/
  harness/           the development harness (light DOM)
  index.html         component catalogue
  component.html     component development page
docs/
  plan.md            the design
  components/<id>.md per-component spec and changelog
```

URL paths mirror filesystem paths (`/src/...`, `/client/...`), so relative imports resolve
identically on disk and over HTTP. That is what lets the client run unbundled — only Lit
is bundled, and it is reached through an import map.

## How components work

Each component extends `MerchantElement`, renders into shadow DOM, and:

- declares `static version` — semver, bumped by hand, shown in the harness
- declares `static harnessSchema` — drives the harness props panel
- takes an injected `api` object, never calling `fetch` directly or hardcoding a URL
- emits namespaced, composed, bubbling events
- exposes `::part()` hooks and reads `--merchant-*` custom properties for theming

Because Tailwind cannot cross a shadow boundary, `bun run css` emits the stylesheet twice:
once as CSS for the harness chrome, once as a `CSSResult` adopted by every component.

## Who uses these

**Merchant staff, not customers** — counter and sales-desk operators, signed in as an
`app_user`. See `docs/plan.md` §0, which also covers the distinction between a customer's
*home branch* (ownership) and a user's *default branch* (location). Those are different
relationships and drive the two separate branch components.

## Status

Phase 0 complete — the stack, the harness, `select-branch` v0.2.0 and `working-branch`
v0.1.0. See `docs/plan.md` §8 for what follows.
