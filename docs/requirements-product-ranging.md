# Requirement: product ranging — which branches carry which lines

**For:** `datagenerator2` · **Raised by:** rm-merchant-components · **Date:** 2026-08-04

**Status:** **built and generated, 2026-08-04.** `product_branch` holds 47,704 rows over the
28 trading branches. `find-product` is unblocked; the figures below are from the shipped
generator unless marked otherwise.

Split out of [`requirements-stock-sourcing.md`](requirements-stock-sourcing.md), where the
concept already exists as `stock.is_stocked_item`. This document promotes it to its own
table, because ranging is cheap and unblocks a component now, while the stock model it is
currently attached to is a much larger job.

> Not all products stocked in all branches
> — `docs/must-cater-for.md`

The only item on that list no requirements doc covered, and `find-product` cannot be
designed without an answer. Today the schema has no product→branch link at all, so a search
can only offer every product at every branch. The wrongness surfaces the first time a
counter assistant searches for something their branch has never carried.

---

## The model: one sparse table, absence is meaningful

The question raised was whether three things are needed — a core-product flag, a
stocked-by-product-and-branch table, and a not-stocked-here marker. **One table, with a
status column. The third is the absence of a row and must never be stored.**

```sql
CREATE TABLE product_branch (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER,
  branch_id  INTEGER,
  status     TEXT NOT NULL,   -- core | stocked | non_stock | not_permitted
  ranged_at  TEXT
);
CREATE UNIQUE INDEX ux_product_branch      ON product_branch(product_id, branch_id);
CREATE INDEX        ix_product_branch_branch ON product_branch(branch_id, product_id);
```

Surrogate `id` plus a unique index on the natural key, rather than a composite primary key:
that is what every other junction table here does (`branch_quick_code`,
`app_user_permission`), and the Stage-2 replicate step renders column specs per dialect with
no composite-PK support. The unique index supplies the `(product_id, branch_id)` direction
anyway, so the measured behaviour is identical. `status` is plain `text` despite NAMING.md
rule 8 — the DDL renderer emits no `CHECK` for any table, and this is not the place to
change that; the generator is the only writer and enforces the four values.

| status | means | counter can |
|---|---|---|
| `core` | carried, and must not run out | sell now |
| `stocked` | carried | sell now |
| `non_stock` | sold here, never held — obtained per order | sell, obtain per order |
| `not_permitted` | may not be sold at this branch | **no** |
| *no row* | not part of this branch's range | sell as a special order |

`non_stock` is today's `stock.is_stocked_item = 0` — the nineteen branches that sell baths
but IBT each one in from the specialist branch. It is kept because it changes search
ordering: a branch that routinely sells baths should surface them ahead of a line it has
never touched, and absence cannot express that.

### Why not a core flag on `product`

A product-level `is_core` breaks on the first exception, and the exceptions are ordinary:
the specialist bathroom branch that carries no core timber, a core line delisted at a small
site. The flag then needs an exception table, which is worse than not having had it.

It also conflates two different decisions — a national merchandising one ("core line for
the business") and a branch service level ("this branch must never run out"). The second is
what drives replenishment, and it is per-branch by definition.

On the junction row it costs nothing: core-everywhere is one row per branch,
core-except-Branch-7 is one row fewer, and no exception mechanism exists to get wrong.

### Why "not stocked" is not stored

Storing the negative means a row per product per branch that says "no" — at the large-merchant
scale below, **3.17M rows of nothing**, and a second place for the truth to drift.

But "not stocked" is not one state, and the counter has to tell three apart:

- **Not here, held elsewhere** → transfer it in
- **Not held anywhere** → special order from the supplier; *still sellable*
- **May not be sold here** → genuinely blocked

The first two fall out of absence plus a lookup across branches. The third does not, and is
the only negative that earns a row: it has to beat the special-order default. It is where
[the accreditation model](requirements-stock-sourcing.md) lands — the branch with no
accredited product specialist — and where age-restricted lines sit at a branch without the
process to check ID.

---

## Why this is not part of `stock`

`stock` currently carries `is_stocked_item`, so ranging would be a column on it. Two reasons
to separate them.

**Policy and state change at different rates.** `product_branch` is a merchandising
decision — do we carry this line, is it core, may we sell it — reviewed occasionally.
`stock` is inventory state — how many, which bin, what it cost — changing continuously. A
slow-changing dimension and a fast-changing fact do not belong in one row.

**Scheduling.** Ranging is a three-column table. `stock` is quantities, costs, min/max,
replenishment method and bin locations, and is already flagged as blocking two components.
Folding ranging into it puts `find-product` behind the entire stock model for no benefit;
separated, it is generatable on its own and `find-product` proceeds.

**Change to the stock requirement:** `stock.is_stocked_item` is dropped — it becomes
`product_branch.status`. Everything else on `stock` is unaffected, and the specialist-branch
design in that document is unchanged: the specialist holds `core`/`stocked` across the
category with real `min_qty`/`max_qty`, the other branches hold `non_stock`.

**No foreign key from `stock` to `product_branch`.** A stock row with no ranging row is a
real state — residual stock of a delisted line, twelve left and no longer ranged — and the
UI should show it as exactly that rather than have generation refuse it.

---

## Measured, at large-merchant scale

Built to the shape described: 25,000 products across 150 branches, 1,500 core lines ranged
everywhere plus ~2,400 branch-specific each.

| | rows | of matrix | size |
|---|---:|---:|---:|
| Sparse — ranged rows only | 579,844 | 15.5% | 11.4 MB |
| Full matrix | 3,750,000 | 100% | — |

**Both index directions are needed, and only one is obvious.**

| query | no index | `(branch_id, product_id)` | `+ (product_id, branch_id)` |
|---|---:|---:|---:|
| search within a branch's range | 2.74 ms | 0.05 ms | 0.04 ms |
| which branches stock this product | 9.16 ms | 9.07 ms | **0.06 ms** |
| branch count for a product | 9.66 ms | 8.73 ms | **0.00 ms** |
| range size for a branch | 9.40 ms | 0.05 ms | 0.05 ms |

`find-product` reads the table by branch; `multi-branch-stock` reads it by product. Indexing
only the first leaves the second doing a full scan at 9 ms — `ux_product_branch` supplies
that direction, `ix_product_branch_branch` the other.

Confirmed against the generated 47,704 rows: "which branches carry this product" plans as
`SEARCH pb USING COVERING INDEX ux_product_branch` at 0.010 ms, and a branch-scoped name
search with status ordering runs at 0.586 ms.

The table is small enough that this is settled: no core shortcut is needed to keep it down,
and adding `non_stock` rows for whole categories has ample headroom.

---

## Generation

At the current dataset's 3,714 products and **28 trading branches** — the 29th is
`branch_type = 'head_office'` and must get no ranging rows at all; it sells nothing.

Order matters, and rule 1 is the one that is easy to get wrong:

1. **Designate the special-order tail first.** Set aside ~12–15% of products as ranged
   nowhere, *before* ranging anything. Doing it the other way round — ranging each branch at
   random and seeing what is left over — leaves the tail to chance: with each of 28 branches
   independently drawing ~800 of 3,714 products, the odds of any given product being missed
   by all of them are near zero, and the tail vanishes. That tail is the special-order path,
   and without it that path is never exercised.
2. **Core range.** ~18% of the remainder marked `core` at every trading branch — the lines
   any merchant holds everywhere: fixings, cement, plasterboard, common timber.
3. **Branch range.** Each branch additionally ranges 700–1,200 products as `stocked`, drawn
   with a bias toward a few product groups so a branch's mix is coherent rather than random.
   A branch strong in timber should look strong in timber.
4. **At least one specialist branch**, per the stock requirement: one branch ranges a whole
   category deeply, every other branch holds `non_stock` across it. Without this,
   `multi-branch-stock` has nothing interesting to show.
5. **A handful of `not_permitted`**, tied to the accreditation and age-restriction models —
   enough to exercise the blocked path at a few branches, not enough to be the common case.

**Check the measured tail, do not assume it matches the designated figure.** How far it
drifts depends entirely on how concentrated the group bias is. The shipped generator
(`ranging_special_order_pct = 14`, off-favoured acceptance 0.3) measures **13.9%** — no
meaningful drift. An early trial with a much harder bias designated 20% and measured 29.3%,
because strong concentration strands whole groups at no branch. Generation logs the measured
figure every run and warns outside a 10–30% band.

**As generated:** 47,704 rows, 1,475–1,914 lines per branch, 517 products (13.9%) ranged
nowhere, specialist branch Leeds over product group 560 — within the "roughly 30–50k rows"
estimate already in the stock requirement.

`ranged_at` is a date; it is only there so "recently ranged" is answerable and can be null.

### Verification

All five run against the proposed DDL; expectations are from the trial run above.

```sql
-- Every trading branch has a plausible range; none empty, none holding everything.
-- Head office must not appear at all.
select b.code, b.branch_type, count(*) ranged,
       sum(status='core') core, sum(status='non_stock') non_stock
from product_branch pb join branch b on b.id = pb.branch_id
group by b.id order by ranged;          -- expect 28 rows, ~1,350-1,650, none head_office

-- Core really is everywhere it should be — trading branches only.
select count(*) from (
  select product_id from product_branch where status='core'
  group by product_id having count(distinct branch_id) <
    (select count(*) from branch where branch_type = 'trading')
);                                       -- expect 0

-- The special-order tail exists. Measured, not designated — see rule 1.
select count(*) from product p
where not exists (select 1 from product_branch where product_id = p.id);
                                         -- expect 15-25% of products

-- The specialist branch is visible: a category one branch holds and others do not.
select b.code, count(*) from product_branch pb
join branch b on b.id = pb.branch_id
where pb.status in ('core','stocked') and pb.product_id in
  (select id from product where product_group_id = :specialist_group)
group by b.id order by 2 desc;           -- expect one branch far ahead

select status, count(*) from product_branch group by status;
```

---

## What it unblocks

`find-product` — searchable, scoped to the working branch, with the three negatives
distinguished in the results: held here, held elsewhere, orderable in. Ordering follows
status, so core lines lead.

It does **not** unblock `stock-check` or `multi-branch-stock`. Ranging says a branch carries
a line, not how many it has; those two still need `stock`. It does let
`multi-branch-stock` answer "which branches carry this" ahead of "how many do they have",
which is the more useful half of that component and the half that survives a stale count.
