// scripts/build-vendor.js — bundle the installed Lit into client/vendor/lit.js.
//
// Components import the bare specifier "lit"; the harness pages map it to this bundle
// with an import map. That keeps component source free of CDN URLs and version pins
// (datagenerator2's UI imports from esm.sh, which needs the network on every cold load),
// while still requiring no bundler for the components themselves — only for this one
// third-party dependency.

import pkg from "../package.json" with { type: "json" };

const result = await Bun.build({
  entrypoints: ["scripts/vendor-entry.js"],
  outdir: "client/vendor",
  target: "browser",
  format: "esm",
  naming: "lit.js",
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("lit bundle failed");
}

const bytes = (await Bun.file("client/vendor/lit.js").arrayBuffer()).byteLength;
console.log(`vendor  lit ${pkg.dependencies.lit}  →  client/vendor/lit.js  ${(bytes / 1024).toFixed(1)}kB`);
