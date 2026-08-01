// scripts/vendor-entry.js — the surface of Lit that components are allowed to use.
// Bundled to client/vendor/lit.js by scripts/build-vendor.js and reached via the
// import map in the harness pages. Adding a directive here (classMap, repeat, …) makes
// it available to every component, so add deliberately rather than by reflex.

export * from "lit";
