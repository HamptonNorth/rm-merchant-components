# Requirement: staff permissions, roles and approval escalation

**For:** `datagenerator2` · **Raised by:** rm-merchant-components · **Date:** 2026-08-01

A self-contained implementation spec. Copy into `datagenerator2/docs/` if that suits.
Design rationale lives in `rm-merchant-components/docs/plan.md` §7.7; this document is
what to build.

**Why now:** the merchant components cannot show or enforce capability without this, and
building them against invented fixtures then retrofitting real data is the expensive order
to do it in. Test data first.

---

## 1. Summary of changes

| # | Change | Kind |
|---|---|---|
| 1 | `app_role` gains `code` and `approval_rank`; two new roles — Regional manager, Head office | changed table |
| 2 | `permission` — catalogue of 15 privileges | new table |
| 3 | `app_user_branch` — which branches a user covers, in what role at each | new table |
| 4 | `app_user_permission` — the grants | new table |
| 5 | `branch` gains `branch_type`; one Head Office branch row | changed table (Decision A) |
| 6 | ~11 new `app_user` rows — 8 regional managers, 3 head office | new data |
| 7 | Indexes on the new tables | new |

Naming follows `datagenerator2/docs/NAMING.md`: singular table names, `_id` FKs, `is_`
booleans, `_pence` integer money, enumerations as text with a CHECK.

---

## 2. The model in one paragraph

A **permission** is a privilege (`raise_purchase_order`). A **role** is a job function
(Manager). A user **covers** one or more branches, holding a role at each, and is
**granted** permissions per branch. A grant may carry an **approval limit**: the action
proceeds freely up to that value and routes to a higher approver above it. Approval
capability is not a separate permission — an approver is simply someone covering the same
branch, holding the same permission, at a higher `approval_rank`, with enough headroom.

---

## 3. Schema

### 3.1 `app_role` (changed)

```sql
CREATE TABLE app_role (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,   -- what application logic keys on
  role          TEXT NOT NULL,          -- display text
  approval_rank INTEGER                 -- NULL = not an approver; higher = more authority
);
```

`code` is new: application logic must not key on display text. `approval_rank` orders the
escalation chain.

| id | code | role | approval_rank |
|---:|---|---|---:|
| 1 | `sales` | Sales | NULL |
| 2 | `purchasing_stock` | Purchasing and stock | NULL |
| 3 | `counter` | Counter | NULL |
| 9 | `manager` | Manager | 1 |
| 10 | `regional` | Regional manager | 2 |
| 11 | `head_office` | Head office | 3 |

Existing ids 1, 2, 3, 9 are unchanged. 10 and 11 are new.

### 3.2 `permission` (new)

```sql
CREATE TABLE permission (
  id          INTEGER PRIMARY KEY,   -- sparse and grouped, mirroring the source matrix
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL CHECK (category IN
                ('sales','pricing','credit','purchasing','stock','works_order')),
  scope       TEXT NOT NULL CHECK (scope IN
                ('working_branch','any_permitted_branch','global')),
  is_limited  INTEGER NOT NULL,      -- whether an approval threshold applies at all
  sort        INTEGER
);
```

### 3.3 `app_user_branch` (new)

```sql
CREATE TABLE app_user_branch (
  id          INTEGER PRIMARY KEY,
  app_user_id INTEGER NOT NULL,
  branch_id   INTEGER NOT NULL,
  app_role_id INTEGER NOT NULL,      -- role may differ per branch
  is_default  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_app_user_branch ON app_user_branch(app_user_id, branch_id);
CREATE INDEX ix_app_user_branch_branch ON app_user_branch(branch_id);
```

**Coverage is enumerated, not implied.** A regional manager gets one row per branch in
their region; head office gets one row per branch. With 28 branches the cost is trivial
(~370 rows total), and the benefit is that every permission and escalation query is the
same simple join at every level — no special case for "covers a region" or "covers
everything".

### 3.4 `app_user_permission` (new)

```sql
CREATE TABLE app_user_permission (
  id                   INTEGER PRIMARY KEY,
  app_user_id          INTEGER NOT NULL,
  branch_id            INTEGER NOT NULL,
  permission_id        INTEGER NOT NULL,
  approval_limit_pence INTEGER          -- NULL = no threshold, never routes for approval
);
CREATE UNIQUE INDEX ux_app_user_permission
  ON app_user_permission(app_user_id, branch_id, permission_id);
CREATE INDEX ix_app_user_permission_branch
  ON app_user_permission(branch_id, permission_id);
```

**A row exists ⇒ the permission is held.** There are no explicit-deny rows and no
`is_granted` column: with no role-level inheritance to override, a denial and an absence
are identical in effect.

Four rules that are easy to get wrong when reading the source matrix:

1. **Y/N is granted / not granted.** An `N` cell produces **no row at all**.
2. **The limit is a threshold, not a ceiling.** Over it the action routes for approval; it
   is never refused outright.
3. **A limit on an `N` row is meaningless — do not carry it across.** Those are leftover
   template values. `raise_purchase_order_any_supplier` `N` `100` means "may not order from
   non-default suppliers", not "may, up to £100".
4. **NULL means no threshold** — never routes. Not "always routes".

Applying this, the sample row in the source matrix (user 1, branch 1) yields **nine** grant
rows, not fifteen.

### 3.5 `branch` (changed — Decision A)

```sql
ALTER: branch gains
  branch_type TEXT NOT NULL DEFAULT 'trading'
              CHECK (branch_type IN ('trading','head_office'))
```

Plus one row: code `00`, name `Head Office`, `branch_type = 'head_office'`, `region_id`
NULL.

Rationale and consequence in §8, Decision A. If declined, head office users take an
existing trading branch as their default and this change is dropped.

---

## 4. Seed data

### 4.1 Permission catalogue

Codes normalised from the source matrix: typos corrected (`overide_`, `overdide_`,
`raise_credit_credit`, `can_rasie_`) and the `can_` prefix dropped from 90/91, since every
permission is a "can".

| id | code | category | `is_limited` | description |
|---:|---|---|---|---|
| 1 | `sales_enquiries` | sales | no | View stock and prices |
| 2 | `sales_counter` | sales | **yes** | View stock and prices, raise sales orders and cash invoices at the counter. Working branch only |
| 3 | `sales_desk` | sales | **yes** | As counter, plus IBT-linked sales lines, back-to-back specials and direct sales |
| 4 | `override_selling_prices` | pricing | no | Alter selling prices within min/max margin limits |
| 6 | `override_selling_prices_any` | pricing | no | Alter selling prices with no margin limit |
| 7 | `raise_credit_note` | credit | **yes** | Raise a credit note for a credit account customer |
| 8 | `raise_cash_credit_note` | credit | **yes** | Raise a cash sale credit note |
| 51 | `raise_purchase_order` | purchasing | **yes** | Raise a purchase order on the default supplier |
| 52 | `raise_purchase_order_any_supplier` | purchasing | no | Raise a purchase order on any supplier |
| 53 | `goods_inward` | stock | no | Book stock in |
| 54 | `stock_take` | stock | no | Input stock count values |
| 55 | `stock_adjustment` | stock | no | Confirm stock adjustments |
| 56 | `raise_ibt` | stock | no | Raise an interbranch transfer |
| 90 | `raise_sales_works_order` | works_order | no | Raise a works order linked to a sales order |
| 91 | `raise_stock_works_order` | works_order | no | Raise a works order for stock replenishment |

`52` and `6` are **capability switches**, not value-limited: they say *whether* you may go
off default supplier / outside the margin band. The value threshold lives on the base
permission each extends (`51` and `4`). This is why their limits in the source matrix are
ignorable rather than merely unused.

`scope` per permission is still open — see §8, Decision E.

### 4.2 New users

Existing: 175 users, ids 1–175, across 28 branches. Add 11:

| Role | Count | Ids | Default branch |
|---|---:|---|---|
| Regional manager | 8 — one per region | 176–183 | largest branch in their region |
| Head office | 3 | 184–186 | Head Office (Decision A) or branch 1 |

Regions are already 8, with 3–4 branches each:

| Region | Branches | Region | Branches |
|---|---:|---|---:|
| North West | 4 | London | 4 |
| North East | 4 | Southern | 3 |
| South West | 3 | Wales | 4 |
| Eastern | 3 | Midlands | 3 |

---

## 5. Generation rules

The goal is data that exercises the components, not uniform data. Flat, identical grants
make every screen look the same and nothing gets tested.

### 5.1 Coverage (`app_user_branch`)

| Role | Branches covered |
|---|---|
| Counter | 1 — their own |
| Sales | 1 for ~90%; **2–3 within one region for ~10%** — the travelling rep |
| Purchasing and stock | 1–2 |
| Manager | 1 — their own |
| Regional manager | every branch in their region (3–4) |
| Head office | every trading branch (28) |

Exactly one row per user has `is_default = 1`.

**Multi-branch users must not have identical grants at every branch.** This is the case
that motivates per-branch grants, and it comes straight from the source matrix: user 1
holds the full set at branch 1 but only `sales_enquiries` at branches 2–4. Generate
non-default branches with a reduced set — `sales_enquiries` alone, or with `sales_counter`
at a lower limit.

### 5.2 Permission sets by role

| Role | Permissions |
|---|---|
| Counter | 1, 2, 7 |
| Sales | 1, 2, 3, 4, 7 |
| Purchasing and stock | 1, 51, 53, 54, 55, 56 |
| Manager | all except 6 |
| Regional manager | all 15 |
| Head office | all 15 |

Withholding `override_selling_prices_any` from Managers gives Regional a reason to exist
beyond bigger numbers. Vary by ±1 permission per user so the data is not uniform.

### 5.3 Approval limits

Ex-VAT, stored as integer pence. Jitter within the ranges; **keep the ordering monotonic up
the chain**, or escalation cannot resolve.

| Role | `sales_counter` | `sales_desk` | `raise_credit_note` | `raise_cash_credit_note` | `raise_purchase_order` |
|---|---:|---:|---:|---:|---:|
| Counter | £250–750 | — | £100–250 | £50–100 | — |
| Sales | £500–1,000 | £1,000–5,000 | £250–500 | £100–250 | — |
| Purchasing and stock | — | — | — | — | £1,000–5,000 |
| Manager | £2,500 | £5,000 | £1,000 | £500 | £10,000–15,000 |
| Regional manager | £10,000 | £25,000 | £5,000 | £2,500 | £50,000 |
| Head office | NULL | NULL | NULL | NULL | NULL |

Head office holding NULL everywhere is what guarantees the chain always terminates.

Permissions with `is_limited = 0` must have `approval_limit_pence` NULL for every user.

---

## 6. How the data is consumed

### 6.1 Effective permissions at a branch

```sql
SELECT p.code, up.approval_limit_pence
  FROM app_user_permission up
  JOIN permission p ON p.id = up.permission_id
 WHERE up.app_user_id = :user AND up.branch_id = :branch;
```

### 6.2 Escalation — who approves

Route to the **lowest-ranked approver above the raiser** who covers the branch, holds the
permission, and has the headroom:

```sql
SELECT u.id, u.given_name, u.surname, r.role, up.approval_limit_pence
  FROM app_user_branch ub
  JOIN app_role r ON r.id = ub.app_role_id
  JOIN app_user u ON u.id = ub.app_user_id
  JOIN app_user_permission up
    ON up.app_user_id = u.id AND up.branch_id = ub.branch_id
 WHERE ub.branch_id    = :branch
   AND up.permission_id = :permission
   AND r.approval_rank IS NOT NULL
   AND r.approval_rank > :raiser_rank            -- 0 when the raiser has no rank
   AND (up.approval_limit_pence IS NULL OR up.approval_limit_pence >= :value_pence)
 ORDER BY r.approval_rank
 LIMIT 1;
```

This is the query that decided against storing grants as JSON: an indexed join here, a full
scan with JSON extraction otherwise.

### 6.3 Sign-in payload

```jsonc
{
  "user":     { "id": 1, "name": "Robert Collins", "defaultBranchId": 1 },
  "branches": [ { "id": 1, "code": "01", "name": "Chester", "role": "manager" } ],
  "permissions": {
    "1": {                                       // keyed by branch id
      "sales_enquiries":      {},                // held, no threshold
      "raise_purchase_order": { "approvalLimitPence": 1500000 }
    }
  }
}
```

A key present means held. The client uses this for affordances only — greying out a button,
warning before submission that a value will route for approval — and **the server re-checks
on every write**.

---

## 7. Verification

Invariants worth asserting at the end of generation. Each has bitten a permission system
somewhere.

```sql
-- 1. Every trading branch has at least one approver (a Manager).
SELECT b.id FROM branch b WHERE b.branch_type = 'trading' AND NOT EXISTS (
  SELECT 1 FROM app_user_branch ub JOIN app_role r ON r.id = ub.app_role_id
   WHERE ub.branch_id = b.id AND r.approval_rank = 1);

-- 2. Every region has a regional manager covering all its branches.
SELECT b.id FROM branch b WHERE b.region_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM app_user_branch ub JOIN app_role r ON r.id = ub.app_role_id
   WHERE ub.branch_id = b.id AND r.code = 'regional');

-- 3. No grant at a branch the user does not cover.
SELECT up.id FROM app_user_permission up WHERE NOT EXISTS (
  SELECT 1 FROM app_user_branch ub
   WHERE ub.app_user_id = up.app_user_id AND ub.branch_id = up.branch_id);

-- 4. Exactly one default branch per user.
SELECT app_user_id FROM app_user_branch GROUP BY app_user_id
 HAVING SUM(is_default) <> 1;

-- 5. Escalation always terminates: every limited permission has an
--    unlimited approver at every trading branch.
SELECT b.id, p.id FROM branch b, permission p
 WHERE b.branch_type = 'trading' AND p.is_limited = 1 AND NOT EXISTS (
   SELECT 1 FROM app_user_permission up JOIN app_user_branch ub
     ON ub.app_user_id = up.app_user_id AND ub.branch_id = up.branch_id
    WHERE up.branch_id = b.id AND up.permission_id = p.id
      AND up.approval_limit_pence IS NULL);

-- 6. No threshold on an unlimited permission.
SELECT up.id FROM app_user_permission up JOIN permission p ON p.id = up.permission_id
 WHERE p.is_limited = 0 AND up.approval_limit_pence IS NOT NULL;

-- 7. app_user.default_branch_id agrees with app_user_branch (Decision B).
SELECT u.id FROM app_user u JOIN app_user_branch ub
    ON ub.app_user_id = u.id AND ub.is_default = 1
 WHERE u.default_branch_id <> ub.branch_id;
```

All seven should return zero rows.

Expected magnitudes: `app_user` 186, `app_user_branch` ~370, `app_user_permission` ~3,200.

---

## 8. Decisions needed

**A. Head office as a branch row.** *Recommend yes.* Without it, head office staff appear
to work at a trading branch, and national-account ownership has nowhere to point. Cost:
branch count becomes 29, so every operational branch picker must filter
`branch_type = 'trading'` — including the two components already built here, which is a
small, known change. Declining is viable: head office users default to branch 1 and
`branch_type` is dropped.

**B. Keep `app_user.default_branch_id`?** It becomes redundant with
`app_user_branch.is_default`. *Recommend keeping it* as a denormalised fast path, with
invariant 7 enforcing agreement — dropping it would break existing consumers for no gain.

**C. Overlapping sales thresholds.** A user holding both `sales_counter` (£500) and
`sales_desk` (£1,000): which applies to a £750 counter sale? The notes suggest these are
tiers — desk ⊃ counter ⊃ enquiries — in which case the rule is "highest tier held", and
they may be better as one tiered value than three grants. If genuinely independent, the
evaluation rule needs stating. **Does not block generation**, but does block enforcement.

**D. Permission id 5** is absent from the source matrix (1,2,3,4,6,7,8) — deliberate gap or
omission?

**E. `scope` per permission.** Proposed because the matrix says "Working branch only" on
`sales_counter` and not on the others, implying it varies. Each of the 15 needs a value:
`working_branch`, `any_permitted_branch` or `global`.

Assumed unless corrected: thresholds are per document (a whole PO or sales order), ex-VAT,
and an over-limit action is created in a pending-approval state rather than refused.

---

## 9. Follow-on, not in this requirement

Adding a Head office role makes **national-account ownership** tractable — 52 customers are
`is_national_account` but the schema can only express branch ownership. Once head office
exists, `customer.ownership_type` (`branch` / `regional` / `head_office`) plus a nullable
owning-user or owning-rep reference becomes the natural shape. Tracked separately in
`rm-merchant-components/docs/upstream-requests.md` §5.
