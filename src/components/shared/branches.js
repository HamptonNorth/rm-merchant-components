// src/components/shared/branches.js — the non-visual core shared by the two branch
// components (docs/plan.md §9).
//
// select-branch (cards) and working-branch (dropdown) answer different questions and have
// different props, a11y models and version numbers, but they resolve and shape the same
// rows. That shaping lives here so the two cannot drift.

// Branch codes are TEXT in the dataset ("01", "31", "51"), not integers — do not coerce.
export function normaliseCodes(value) {
  if (!value) return null;
  const list = Array.isArray(value) ? value : String(value).split(",");
  const codes = list.map((c) => String(c).trim()).filter(Boolean);
  return codes.length ? codes : null;
}

// Lit converter so `allowed-codes="01,02,31"` works in plain HTML, while JS callers can
// assign a real array. JSON in an attribute would be worse to write by hand.
export const codesConverter = {
  fromAttribute: (value) => normaliseCodes(value),
  toAttribute: (value) => (Array.isArray(value) ? value.join(",") : (value ?? null)),
};

// Preserves the server's ordering (region name, then branch code) while grouping.
export function groupByRegion(rows) {
  const byRegion = new Map();
  for (const b of rows) {
    const key = b.region_name ?? "Unassigned";
    if (!byRegion.has(key)) byRegion.set(key, { name: key, code: b.region_code, rows: [] });
    byRegion.get(key).rows.push(b);
  }
  return [...byRegion.values()];
}

export function branchLabel(branch) {
  return `${branch.code} — ${branch.name}`;
}

// Codes that were asked for but are not in the dataset. Silently dropping them makes a
// typo in an access list look like a permissions problem, which is a miserable thing to
// debug; both components surface this instead.
export function missingCodes(requested, rows) {
  if (!requested?.length) return [];
  const present = new Set(rows.map((r) => r.code));
  return requested.filter((c) => !present.has(c));
}
