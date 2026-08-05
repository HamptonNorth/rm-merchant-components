# Requirement: order lines — qualifiers and specials

**For:** `rm-merchant-components` (component design) and `datagenerator2` (the data behind it)
**Raised by:** counter workflow · **Date:** 2026-08-05

Domain knowledge that shapes the order-line component before it is built. Both mechanisms
here are line-level, and both are cheap to design in now and expensive to retrofit, because
they change what a line *is*.

---

## 1. A line can carry qualifying text

**A product is sold, and text is added to it.** Paint is the clearest case:

| Product | Line qualifier |
|---|---|
| `2.5L Mixed Dulux Emulsion` | `colour 475` |

The SKU is real and stocked. The colour is **not a product attribute and not a variant** —
it is information recorded against the line.

**Do not model paint as a configurator.** Bases, tint formulas, colourant volumes and fan
decks belong to the mixing operation, not to the sales system. A counter sells "2.5 litres of
mixed emulsion" and writes down which colour; the paint shop does the rest. Building a
formula engine would be solving the wrong company's problem, and the combinatorics that make
it look hard — 1,200 colours × sizes × finishes — evaporate the moment the colour is a string
on a line rather than a row in `product`.

**This pattern is common, not paint-specific.** Cut lengths, machining instructions, "as per
sample", a customer's own reference for the item. The existing flag is
`product.allow_description_change`, set on **198 products, all of them timber** —
construction, planed and machined joinery, which is the cut-to-order case. Paint would want
the same flag, and the flag itself probably wants a hint about *what* to prompt for.

**What it means for the line:** a line carries free text alongside the product, that text
prints on the ticket and the invoice, and it is part of what the customer agreed to buy.

---

## 2. Specials — products created on the fly

The other mechanism, and a different one. A customer wants **grey** guttering and clips when
only black is ranged. Nobody adds grey to the catalogue for one order. Instead:

- a product is created **at the point of sale**, code prefixed **`ZZ-`**
- it **inherits** the donor product's analysis codes and settings — group, UOM, tax, supplier,
  margins — so it reports and prices like the thing it was cloned from
- the description is edited: *black* → *grey*
- the **selling price is usually entered by hand**, because there is no price list for it
- it is typically bought **back-to-back** against the order rather than stocked

Already on the list as *"Specials - add using product templates. Auto creation `based on`"*
(`must-cater-for.md`). The related existing flag is `product.allow_direct_ex_works`, set on
**437 products**.

### Which mechanism, when

The distinction is the whole point and is easy to blur:

| | The SKU is | You are |
|---|---|---|
| **Qualifier** | correct | adding information to it — `colour 475` |
| **Special** | absent | creating one — grey guttering that is not ranged |

A qualifier never creates a product row. A special always does.

---

## 3. A basket is a working document, not an order being created

It changes kind as well as content, and the counter does not know the outcome when it starts:

> starts as a **collected counter sale** → morphs into **delivered** → three lines are
> deleted → ends up as a **quote**, because the customer did not have enough money.

So neither the fulfilment (collect / deliver) nor the document type (order / quote) is a
choice made at creation. Both are properties of the basket that change while it is open, and
the component must let them change rather than asking up front and locking it in. Lines are
freely deletable throughout.

### Fulfilment is a pricing dimension, not a logistics flag

Some commodities **price differently collected, delivered and direct**, so flipping the
basket reprices it. That is not a rounding detail: the profile where it bites is heavyside
commodities, where haulage is most of the cost.

| Group | Products | Avg tier-1 price |
|---|---:|---:|
| `Top.Heavyside.Bricks` | 120 | **£1.02** |
| `Top.Heavyside.Roofing` | 60 | **£1.53** |
| `Top.Heavyside.Paving_and_walls` | 120 | £73.03 |
| `Top.Heavyside.Plaster_boards` | 54 | £353.53 |

A penny either way on a brick is a percentage; delivering 500 of them is a lorry. **Direct**
is a third basis, not a variant of delivery — supplier straight to site, no double handling,
and a different margin structure again. `product.allow_direct_ex_works` is set on 437
products and is the nearest thing the schema has to it today.

**A price is only meaningful alongside the basis it was quoted on.** So a line records
`priced_on`, and a flip does not silently reprice: it marks the lines that were quoted on the
old basis. Someone told the customer a number, and a component should not quietly change it.

### The default depends on who is serving

| | Starts as | Because |
|---|---|---|
| **Trade counter** | `collect` | The customer is standing there. A builder with a working pickup thinks nothing of slinging a dozen bags of cement in the back. |
| **Back-office sales** | **not yet asked** | *"Will that be delivered, or are you taking it now?"* comes straight after picking the customer — and a retail caller almost certainly wants it delivered. |

So "not yet asked" is a real state, distinguishable from `collect`. Counter staff read it
instinctively from the customer in front of them; a sales desk on the phone cannot, and has
to ask before it can price anything.

### Parked orders

A merchant runs **several counters**, split by product knowledge. That split is already the
top of the product hierarchy:

| Counter | Group | Products |
|---|---|---:|
| Lightside — plumbing, fittings, bathroom | `Top.Lightside` | 1,928 |
| Heavyside — bricks, cement, drainage | `Top.Heavyside` | 720 |
| Timber | `Top.Timber` | 593 |
| Tools | `Top.Tools` | — |

**One basket moves between them.** A customer buys a hammer at Tools, walks to Timber for
plywood, then back to Lightside for screws — one order, three counters, three members of
staff. Between each, the basket is **parked**: set down under a reference, picked up
elsewhere.

**This settles an open architectural question.** Baskets cannot live on the counter PC. A
parked basket must be retrievable from a *different* counter, so the write store is
**per-branch**, not per-user — whatever is decided about read replicas. It also cannot live
in the readonly dataset: it is the first thing this system writes, and it belongs in its own
local database beside it.

---

## 4. What this forces on the order-line component

**The basket outlives any one counter, staff member or intention.** It carries its own
reference, its state (active / parked / quoted / confirmed), its fulfilment, and who last
touched it — not just a list of lines.

**Lines must be self-describing.** A line cannot be `(product_id, qty, price)`. It carries:

- the **qualifying text**, where the product allows it
- the **price it was sold at**, not a product id to be re-priced later. `aged_debt.cost_pence`
  already sets this precedent by snapshotting the cost used at the moment of sale rather than
  recomputing from a weighted average that has since moved. Under the local-first
  architecture it stops being merely prudent: the branch replica's price *is* what the
  customer was quoted.
- for a special, the **donor** it was cloned from, so the inheritance is auditable

**Manual pricing is already permissioned.** `override_selling_prices` exists in the
permission catalogue with an approval rank behind it, so a hand-typed price on a special has
somewhere to route. It should use that rather than inventing a rule.

**Specials are a write, at a branch, under a local-first architecture.** Creating `ZZ-…` is
the second write the counter performs (the first being the order itself). Options: allocate
the code locally from a branch-prefixed range and sync it with the order, or ping head office
the way the invoice number does. The order and its special should travel together either way
— a line referencing a product the centre has never heard of is the failure mode to avoid.

---

## 5. Upstream, for datagenerator2

Not blocking the component, which can be built against these rules today.

- **`allow_description_change` is timber-only** (198 products). Realistic generation would set
  it wherever a qualifier is normal — paint, made-to-order joinery, cut sheet material.
- **No paint exists.** The Decorating group is `Brushes_and_rollers`, 61 products. Nothing in
  the catalogue can demonstrate the qualifier case in its most obvious form. A handful of
  mixed-base emulsions and gloss in 1L/2.5L/5L would do it.
- **No specials.** No `ZZ-` products, and no column marking a product as one or naming its
  donor. A `created_from_product_id` and a flag would make the mechanism visible in data.
- **Variants barely exist**, if the fixed-colour case is ever wanted separately: 229 products
  carry a structured `colour` in `specification`, but only **two families** are offered in
  more than one colour, and both are bricks. "What colours does that come in" cannot be
  answered from this dataset by any means.
