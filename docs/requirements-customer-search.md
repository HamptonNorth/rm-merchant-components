# Requirement: counter quick codes and branch neighbours

**For:** `datagenerator2` · **Raised by:** rm-merchant-components · **Date:** 2026-08-03

Two small tables plus a little seed data, needed by the **find-customer** component
(rm-merchant-components `docs/plan.md` §9). Everything else that component needs already
exists.

Naming follows `datagenerator2/docs/NAMING.md`: singular tables, `_id` FKs, `is_` booleans.

---

## Why

Most collected sales happen face to face at a trade counter, and the same workflow has to
sell a 50p bolt for cash and 20 pallets of bricks on account. Two things follow:

- **Speed at the counter.** A single keystroke has to reach the everyday cash account, so
  digits 1–9 map to accounts. That mapping is **per branch** — Chester's "1" is Chester's
  cash sale account, so takings attribute to the branch that made the sale.
- **The catchment is not the region.** A customer standing at Chester may be on Bangor's
  books; Cardiff and Bristol are 45 minutes apart across a regional boundary. Widening a
  search needs a curated neighbour list, because drive time does not follow the region map.

---

## 1. `branch_quick_code`

```sql
CREATE TABLE branch_quick_code (
  id          INTEGER PRIMARY KEY,
  branch_id   INTEGER NOT NULL,
  quick_code  INTEGER NOT NULL CHECK (quick_code BETWEEN 1 AND 9),
  customer_id INTEGER NOT NULL,
  label       TEXT                     -- optional counter label; NULL uses the customer name
);
CREATE UNIQUE INDEX ux_branch_quick_code ON branch_quick_code(branch_id, quick_code);
CREATE INDEX ix_branch_quick_code_customer ON branch_quick_code(customer_id);
```

One row per digit per branch. A branch need not fill all nine.

### Seed data

**First, 28 counter cash accounts** — one `customer` row per *trading* branch (Head Office
excluded), because a sale has to post to a customer account and every branch needs its own:

| Column | Value |
|---|---|
| `name` | `Cash Sale — <branch name>` |
| `account_type` | `cash` |
| `credit_status` | `normal` |
| `credit_limit_pence` | `0` |
| `home_branch_id` | that branch |
| `is_national_account` | `0` |
| `account_code` | normal generated format |

Optional but recommended: `customer.is_counter_account` boolean, so the UI can label these
as the branch's own counter account rather than showing them as an ordinary customer among
search results. Without it they are indistinguishable from a real cash customer called
"Cash Sale".

**Then the mappings**, per trading branch:

| Quick code | Points at |
|---|---|
| 1 | that branch's counter cash account (always) |
| 2–9 | a handful of that branch's existing `account_type = 'cash'` customers |

Do not fill every branch to 9 — vary it, 3 to 9 codes used, so the component is exercised
against sparse and full keypads. Newtown has only 91 customers and Bangor 244, so those
branches should be at the sparse end naturally.

---

## 2. `branch_neighbour`

```sql
CREATE TABLE branch_neighbour (
  id                  INTEGER PRIMARY KEY,
  branch_id           INTEGER NOT NULL,
  neighbour_branch_id INTEGER NOT NULL,
  seq                 INTEGER NOT NULL   -- 1 = nearest
);
CREATE UNIQUE INDEX ux_branch_neighbour ON branch_neighbour(branch_id, neighbour_branch_id);
CREATE INDEX ix_branch_neighbour_seq ON branch_neighbour(branch_id, seq);
```

2–4 neighbours per trading branch, ordered by `seq`. Head Office has none.

**This is curated data, not derived.** Deriving it from `region_id` would defeat the point —
the cases that matter are the ones the region map gets wrong. Deriving it from postcode
distance would too: Stockport and Sheffield are 40 miles apart with the Peak District in
between.

### Suggested seed

The cross-region pairs are the ones worth getting right; they are marked **✱**.

| Branch | Neighbours (nearest first) |
|---|---|
| 01 Chester | 02 Warrington, 03 Stockport, **✱** 94 Bangor |
| 02 Warrington | 03 Stockport, 01 Chester, 04 Lancaster |
| 03 Stockport | 02 Warrington, **✱** 12 Sheffield, 01 Chester |
| 04 Lancaster | 02 Warrington, **✱** 13 Leeds, 03 Stockport |
| 11 Newcastle | 14 Darlington, 13 Leeds |
| 12 Sheffield | 13 Leeds, **✱** 03 Stockport, **✱** 41 Derby |
| 13 Leeds | 12 Sheffield, 14 Darlington, **✱** 04 Lancaster |
| 14 Darlington | 11 Newcastle, 13 Leeds |
| 21 Bristol | **✱** 91 Cardiff, 22 Exeter |
| 22 Exeter | 23 Plymouth, 21 Bristol |
| 23 Plymouth | 22 Exeter, 21 Bristol |
| 31 Peterborough | 32 Cambridge, **✱** 43 Northampton |
| 32 Cambridge | 31 Peterborough, 33 Ipswich, **✱** 43 Northampton |
| 33 Ipswich | 32 Cambridge, 31 Peterborough |
| 41 Derby | 42 Birmingham, **✱** 12 Sheffield |
| 42 Birmingham | 41 Derby, 43 Northampton, **✱** 93 Newtown |
| 43 Northampton | 42 Birmingham, **✱** 31 Peterborough, **✱** 32 Cambridge |
| 51 North London | 52 West London, 54 East London, 53 South London |
| 52 West London | 51 North London, 53 South London, **✱** 62 Reading |
| 53 South London | 54 East London, 52 West London, **✱** 63 Maidstone |
| 54 East London | 53 South London, 51 North London, **✱** 63 Maidstone |
| 61 Southampton | 62 Reading, **✱** 53 South London |
| 62 Reading | **✱** 52 West London, 61 Southampton |
| 63 Maidstone | **✱** 53 South London, **✱** 54 East London |
| 91 Cardiff | 92 Swansea, **✱** 21 Bristol |
| 92 Swansea | 91 Cardiff, **✱** 21 Bristol |
| 93 Newtown | **✱** 42 Birmingham, 91 Cardiff, **✱** 01 Chester |
| 94 Bangor | **✱** 01 Chester, 93 Newtown |

Twelve of the 28 branches have a neighbour outside their own region, which is the point of
the table existing.

**Symmetry is expected but not enforced.** Generate pairs both ways, but leave it possible
for a large branch not to list a small one. Verification query 5 reports asymmetry rather
than failing on it.

---

## 3. Indexes and FTS on `customer`

Not new tables, but the searches this feature adds are the ones that need them.

### What the worst case actually is

`LIMIT 25` lets SQLite stop early when a term is common, so a popular name is not the
problem. The expensive case is a term matching **nothing**, which must scan the whole
table — and "no such customer" is an ordinary counter outcome, not an edge case.

| Query | 39,424 rows | ~394,000 rows |
|---|---:|---:|
| name `LIKE '%smith%'` — 615 hits, exits early | 0.15 ms | 0.17 ms |
| name `LIKE '%qzx%'` — **no hits, full scan** | 2.9 ms | **25.3 ms** |
| the same, branch-filtered | 1.3 ms | 9.1 ms |
| trigram FTS, either term | 0.01 ms | **0.01 ms** |

An earlier draft of this document quoted 23.7 ms at 39k rows. That was a cold, one-shot
measurement — first-touch I/O against a 100 MB file, paid once — not the steady-state cost.
The honest figure at 39k is ~2.9 ms.

### Indexes — `COLLATE NOCASE` is not optional

```sql
CREATE INDEX ix_customer_branch      ON customer(home_branch_id);
CREATE INDEX ix_customer_postcode    ON customer(postcode COLLATE NOCASE);
CREATE INDEX ix_customer_account     ON customer(account_code COLLATE NOCASE);
CREATE INDEX ix_customer_national    ON customer(is_national_account) WHERE is_national_account = 1;
```

The collation is the whole point. `LIKE` is case-insensitive by default, so SQLite can only
use an index to serve a prefix `LIKE` when that index is `NOCASE` — with a plain index it
keeps scanning:

| Query | plain index | `NOCASE` index |
|---|---:|---:|
| `postcode LIKE 'SK4%'` | 0.77 ms, still `SCAN` | **0.02 ms**, seek |
| `account_code LIKE 'CA/00272%'` | 2.22 ms, still `SCAN` | **0.01 ms**, seek |

A plain `customer(postcode)` index — which is what the earlier version of this document
asked for — measurably achieves nothing.

`customer(name)` is deliberately absent: no B-tree serves an unanchored `LIKE '%…%'`.

### FTS5 over `customer.name` — use the trigram tokenizer

```sql
CREATE VIRTUAL TABLE customer_fts USING fts5(
  name, town, content='customer', content_rowid='id', tokenize='trigram'
);
INSERT INTO customer_fts(rowid, name, town) SELECT id, name, town FROM customer;
```

**Trigram, not the default `unicode61`.** Trigram matches substrings, so results are
identical to today's `LIKE '%…%'` — 615 hits either way for "smith". The default tokenizer
is token-prefix: `smith*` returns 605, finding "Smithson" but missing "Arrowsmith". Trigram
also has a three-character minimum, which sits neatly under the component's rule of not
searching below four characters.

Build cost is ~1 s at 394k rows (33 ms at 39k) and the dataset is generated once, so this is
paid at generation and never again.

**Justified by scale rather than by today.** At 39k rows 2.9 ms needs no help. At 394k it is
25 ms, and branch filtering only brings that to 9 ms. Since the generated customer count is
configurable and a real merchant holds hundreds of thousands of accounts, this is worth
doing while the schema is open rather than retrofitting later.

Postcode and account code stay on `NOCASE` B-trees — both are anchored prefix matches, where
a B-tree is cheaper and simpler than FTS.

---

## 3b. Note on `account_code_format` (no change asked for)

`account_code_format` selects one of four shapes, and the consumer must not assume any of
them:

| Setting | Shape | Example |
|---|---|---|
| 1 | `9999999` | `0027200` — no letters, no slash |
| 2 | `XX/999999` | `CA/027200` |
| 3 | `XX/9999999` | `CA/0027200` — current dataset |
| 4 | `XXX/999999` | `CAS/027200` |

find-customer routes a typed term to an account-code search by **inferring the shape from
sampled `account_code` values**, not by pattern-matching a fixed format. Recorded here so it
is not accidentally broken from this side: a change to `account_code_format` needs no
coordination, but a *new* shape outside these four would.

The awkward one is format 1. With no letters and no slash there is nothing to distinguish an
account code from any other numeric input, so under that format a numeric term routes to
account code where under 2–4 it would not. Single-digit input remains a quick code
regardless, since the numeric format is seven digits long.

## 4. Verification

All should return zero rows.

```sql
-- 1. Every trading branch has quick code 1.
SELECT b.id FROM branch b WHERE b.branch_type = 'trading' AND NOT EXISTS (
  SELECT 1 FROM branch_quick_code q WHERE q.branch_id = b.id AND q.quick_code = 1);

-- 2. Quick code 1 points at that branch's own counter cash account.
SELECT q.id FROM branch_quick_code q JOIN customer c ON c.id = q.customer_id
 WHERE q.quick_code = 1 AND (c.account_type <> 'cash' OR c.home_branch_id <> q.branch_id);

-- 3. No quick code points at a credit account.
SELECT q.id FROM branch_quick_code q JOIN customer c ON c.id = q.customer_id
 WHERE c.account_type <> 'cash';

-- 4. Every trading branch has at least two neighbours, and none is itself.
SELECT b.id FROM branch b WHERE b.branch_type = 'trading' AND (
  (SELECT count(*) FROM branch_neighbour n WHERE n.branch_id = b.id) < 2
  OR EXISTS (SELECT 1 FROM branch_neighbour n
              WHERE n.branch_id = b.id AND n.neighbour_branch_id = b.id));

-- 5. Asymmetric pairs — a report, not a failure.
SELECT n.branch_id, n.neighbour_branch_id FROM branch_neighbour n WHERE NOT EXISTS (
  SELECT 1 FROM branch_neighbour r
   WHERE r.branch_id = n.neighbour_branch_id AND r.neighbour_branch_id = n.branch_id);

-- 6. Head Office has no neighbours and no quick codes.
SELECT 1 FROM branch b
 WHERE b.branch_type = 'head_office' AND (
   EXISTS (SELECT 1 FROM branch_neighbour n WHERE n.branch_id = b.id)
   OR EXISTS (SELECT 1 FROM branch_quick_code q WHERE q.branch_id = b.id));
```

Expected magnitudes: `customer` 39,452 (+28), `branch_quick_code` ~150, `branch_neighbour`
~75.

---

## 5. Not in this requirement

**Authorised buyers.** Some large accounts want only named individuals from the customer
permitted to book goods out. Agreed approach is an ID image on `customer_contact`, added
later; noted here so it is not lost.

**A `sale` or `order` table.** Everything above is about *finding* the customer. The order
itself — collect versus delivery, works orders, back-to-back purchase orders, price
pointers — is a separate piece of work.
