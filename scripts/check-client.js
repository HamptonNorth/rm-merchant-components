// scripts/check-client.js — cheap validation that the unbundled client actually resolves.
//
// Components are served to the browser as raw ESM, so a typo in a relative import or a
// syntax error is only discovered by loading the page. Bundling the same entry points
// here (throwing the output away) catches both in about a second. This only works because
// URL paths mirror filesystem paths (server/app.js) — every client import is relative and
// resolves the same way from disk. Only `lit` is external: the browser gets it from the
// import map, not from node_modules.
//
//   bun run check

import { readdirSync, existsSync } from "node:fs";

const entrypoints = [
  "client/harness/index-page.js",
  "client/harness/component-page.js",
  "src/components/registry.js",
];

// Every component module, so an unreferenced one still gets checked.
const componentsDir = "src/components";
for (const dir of readdirSync(componentsDir, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name === "shared") continue;
  const entry = `${componentsDir}/${dir.name}/${dir.name}.js`;
  if (existsSync(entry)) entrypoints.push(entry);
}

const result = await Bun.build({
  entrypoints,
  target: "browser",
  format: "esm",
  external: ["lit"],
  throw: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  console.error(`\ncheck  FAILED  (${entrypoints.length} entry points)`);
  process.exit(1);
}

console.log(`check  ok  ${entrypoints.length} entry points resolve and parse`);
for (const e of entrypoints) console.log(`         ${e}`);
