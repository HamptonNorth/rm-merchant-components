// src/components/shared/badges.js — the badge palette.
//
// Shared so that "look at this" means the same thing in every component. Colour carries
// meaning here rather than decoration, and the meanings are deliberately few:
//
//   good     yes, now, no caveat
//   info     yes, with a step attached
//   caution  true, but NOT the assumption you would otherwise make
//   stop     no
//   neutral  a fact, no judgement
//
// `caution` is the one that earns its keep. It marks a figure or state that is correct but
// would be read wrongly if skimmed — a product carried at other branches rather than this
// one, or a price that already has VAT in it. Both are cases where quietly being right is
// not good enough.

export const BADGE = {
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  caution: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  stop: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

// The shape as well as the palette, so badges do not drift in padding either.
export const BADGE_BASE = "rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";
