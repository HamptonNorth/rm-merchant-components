// scripts/features.js — the feature finder at the terminal.
//
//   bun run features                 every feature, with counts
//   bun run features delivery        anything matching "delivery"
//   bun run features gap             what the dataset cannot demonstrate
//
// Same catalogue as /features in the harness; this exists because the flipping between this
// project and datagenerator2 happens at a shell, not in a browser.

import { listFeatures, listDemoFeatures } from "../server/queries/features.js";
import { dbPath } from "../server/db.js";

const args = process.argv.slice(2);
// --demo shows exactly what the outward-facing catalogue would, in its wording.
const asProspect = args.includes("--demo");
const q = args.filter((a) => a !== "--demo").join(" ");
const { rows, tookMs } = asProspect ? listDemoFeatures({ q, limit: 3 }) : listFeatures({ q, limit: 3 });

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const amber = (s) => `\x1b[33m${s}\x1b[0m`;

console.log(dim(dbPath));
console.log(`${rows.length} feature${rows.length === 1 ? "" : "s"}${q ? ` matching "${q}"` : ""} · ${tookMs} ms\n`);

let entity = null;
for (const f of rows) {
  if (asProspect) {
    // No entity headings for a prospect — the internal taxonomy is not their vocabulary.
  } else if (f.entity !== entity) {
    entity = f.entity;
    console.log(bold(entity.toUpperCase()));
  }
  const count = f.total === 0 ? amber("none in this dataset") : `${f.total.toLocaleString("en-GB")}`;
  console.log(`  ${f.label}  ${count}`);
  if (f.error) console.log(`    ${amber("query failed: " + f.error)}`);
  for (const e of f.examples) {
    const open = f.component && e.props
      ? dim(`  → /c/${f.component}?props=${encodeURIComponent(JSON.stringify(e.props))}`)
      : "";
    console.log(`    ${dim("#" + e.id)} ${e.label}${e.detail ? dim(" — " + e.detail) : ""}${open}`);
  }
  console.log(dim(`    ${f.why}`));
  console.log();
}
