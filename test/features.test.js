// The feature finder. These are cheap to get wrong in a way nobody notices: a probe that
// throws, or silently returns nothing, looks identical to "this dataset has none of those" —
// and the whole point of the catalogue is telling those two apart.

import { test, expect } from "bun:test";
import { listFeatures, listDemoFeatures, featureEntities } from "../server/queries/features.js";

const all = listFeatures({});

test("every probe runs without error", () => {
  // A broken query and a genuine absence both render as zero, so the error field is the only
  // thing separating "no such record" from "I typo'd a column name". Three staff probes
  // shipped referencing app_user.first_name, which does not exist.
  const broken = all.rows.filter((r) => r.error);
  expect(broken.map((r) => `${r.id}: ${r.error}`)).toEqual([]);
});

test("non-gap features actually find something", () => {
  // If a feature outside the gap section returns nothing, either the dataset changed shape or
  // the probe is wrong. Either way it needs looking at rather than sitting there as a silent
  // zero.
  const empty = all.rows.filter((r) => r.entity !== "gap" && r.total === 0);
  expect(empty.map((r) => r.id)).toEqual([]);
});

test("gaps are gaps — they must stay empty", () => {
  // These document what the dataset cannot demonstrate. If one starts returning rows, the
  // upstream gap has been filled and the note should be retired rather than left lying.
  for (const r of all.rows.filter((r) => r.entity === "gap")) {
    expect(r.total, `${r.id} now returns rows — the upstream gap may be fixed`).toBe(0);
  }
});

test("examples carry props that would open the component", () => {
  for (const f of all.rows.filter((f) => f.component && f.total > 0)) {
    expect(f.examples.length, `${f.id} has a component but no examples`).toBeGreaterThan(0);
    for (const e of f.examples) {
      expect(e.props, `${f.id} example ${e.id} has no props`).toBeTruthy();
      // A prop resolving to null or undefined would open the component in a broken state,
      // which is worse than not offering the link.
      for (const [k, v] of Object.entries(e.props)) {
        expect(v, `${f.id}.${k} is nullish`).not.toBeNull();
        expect(v).toBeDefined();
      }
    }
  }
});

test("the total is the whole count, not the page", () => {
  // count(*) over () is computed before LIMIT. If that ever stops being true, every total
  // silently becomes 5 and the catalogue starts lying about scale.
  const few = listFeatures({ q: "on stop", limit: 2 });
  const more = listFeatures({ q: "on stop", limit: 5 });
  expect(few.rows[0].examples.length).toBe(2);
  expect(more.rows[0].examples.length).toBe(5);
  expect(few.rows[0].total).toBe(more.rows[0].total);
  expect(few.rows[0].total).toBeGreaterThan(5);
});

test("search matches the reason, not just the label", () => {
  // Searching for what you are trying to do — "empty state" — should find the feature whose
  // label never mentions it.
  const hits = listFeatures({ q: "empty state" });
  expect(hits.rows.length).toBeGreaterThan(0);
  expect(hits.rows.some((r) => r.id === "customer-no-delivery-addresses")).toBe(true);
});

test("entity filter narrows to one section", () => {
  const products = listFeatures({ entity: "product" });
  expect(products.rows.length).toBeGreaterThan(0);
  for (const r of products.rows) expect(r.entity).toBe("product");
  expect(featureEntities()).toContain("gap");
});

test("ids are unique", () => {
  const ids = all.rows.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
});

// --- the audience split ------------------------------------------------------

test("nothing in the gap section is ever demo-visible", () => {
  // The sharpest hazard: the gaps are a list of what this system cannot do, sitting in the
  // same array as the demos. A prospect must never reach them.
  const demo = listDemoFeatures({});
  expect(demo.rows.filter((r) => r.entity === "gap")).toEqual([]);
  // And nothing in the demo catalogue may carry the internal "GAP:" prose either.
  for (const r of demo.rows) {
    expect(r.why, `${r.id} leaks a gap note`).not.toContain("GAP:");
  }
});

test("audience is an allowlist — unmarked means internal", () => {
  // Forgetting to mark a new probe should hide a demo, never publish a weakness. If this
  // ever inverts, every probe added in a hurry becomes outward-facing.
  const all = listFeatures({});
  const demoIds = new Set(listDemoFeatures({}).rows.map((r) => r.id));
  for (const r of all.rows) {
    if (!demoIds.has(r.id)) expect(r.audience).toBe("internal");
  }
  expect(demoIds.size).toBeGreaterThan(0);
  expect(demoIds.size).toBeLessThan(all.rows.length);
});

test("the demo catalogue speaks trade, not schema", () => {
  // "product_branch.status = non_stock" is precise and useless to a buyer.
  const demo = listDemoFeatures({});
  for (const r of demo.rows) {
    for (const term of ["product_branch", "unpaid_pence", "uom_type", "tally_id", "price_break"]) {
      expect(`${r.label} ${r.why}`, `${r.id} uses schema wording`).not.toContain(term);
    }
  }
});

test("every demo feature has something to show", () => {
  // A prospect-facing entry that resolves to nothing is worse than not listing it.
  for (const r of listDemoFeatures({}).rows) {
    expect(r.total, `${r.id} is demo-visible but empty`).toBeGreaterThan(0);
    expect(r.examples.length).toBeGreaterThan(0);
  }
});

test("the demo shape carries no development detail", () => {
  // No timings, no plans, no entity facets, no internal wording.
  const demo = listDemoFeatures({});
  for (const r of demo.rows) {
    expect(r.demoLabel).toBeUndefined();
    expect(r.demoWhy).toBeUndefined();
  }
});
