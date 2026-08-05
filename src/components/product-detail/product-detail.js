// product-detail v0.1.0 — everything about one line, from one branch.
//
// The card find-product hands off to. It answers the follow-up questions: what does it cost,
// in what unit, how many come on a pallet, who supplies it — and, the one a catalogue card
// usually forgets, whether this branch may sell it at all. Availability is carried straight
// through from the ranging model rather than dropped on the way, because a detail card that
// omits it repeats the mistake find-product exists to avoid.
//
// The pricing display is the part that had to be got right. `tier` is not a quantity break
// for 3,697 of 3,714 products — their four prices simply descend, which is a customer price
// band. Only 17 lines carry genuine quantity ranges. So a range is shown only where the
// scheme defines one, and the heading says which kind of pricing is on screen. Printing
// "qty 1-1" against 99.5% of the catalogue would be confidently wrong.

import { html, css, nothing } from "lit";
import { MerchantElement } from "../shared/merchant-element.js";
import { fmtPence, fmtDate, withVat } from "../shared/format.js";
import { availabilityMeta, perLabel } from "../shared/availability.js";
import { BADGE, BADGE_BASE } from "../shared/badges.js";

export class MerchantProductDetail extends MerchantElement {
  static version = "0.1.0";

  static styles = [
    ...MerchantElement.styles,
    css`
      :host {
        /* The host sizes the component; the component adapts to whatever it is given. That
           is why the layout below uses @lg: (container) rather than lg: (viewport) — a
           viewport query would put this card in two columns inside a narrow sidebar on a
           wide screen, which is exactly what it did before. */
        container-type: inline-size;
        display: block;
      }
    `,
  ];

  static properties = {
    productId: { type: Number, attribute: "product-id" },
    workingBranchId: { type: Number, attribute: "working-branch-id" },
    heading: { type: String },
    showCost: { type: Boolean, attribute: "show-cost" },
    vatInclusive: { type: Boolean, attribute: "vat-inclusive" },
    dense: { type: Boolean },
    selectedTier: { type: Number, attribute: "selected-tier" },
    detail: { attribute: false, state: true },
  };

  static harnessSchema = [
    {
      name: "productId",
      type: "number",
      default: 1,
      description:
        "Which product. Use the scenarios for the interesting shapes — a line priced two ways, one with genuine quantity breaks, and one this branch may not sell.",
    },
    {
      name: "workingBranchId",
      type: "number",
      default: 7,
      description:
        "The branch asking. A branch id, not a branch code. Decides the availability verdict and, when the branch cannot supply it, which other branches are listed.",
    },
    { name: "heading", type: "string", default: "", description: "Optional heading above the card." },
    {
      name: "showCost",
      type: "boolean",
      default: false,
      description:
        "Show cost and margin. Off by default: counter staff generally may not see cost. There is no view_cost permission in the dataset yet, so this is a prop rather than a permission check — see docs/components/product-detail.md.",
    },
    {
      name: "vatInclusive",
      type: "boolean",
      default: false,
      description:
        "Show selling prices with VAT added — what a retail caller is asking for. Off for the trade counter, where ex-VAT is the working figure. Cost is unaffected: input tax is reclaimed, so cost is ex-VAT by nature. The emitted price stays ex-VAT whichever way this is set.",
    },
    { name: "dense", type: "boolean", default: false, description: "Tighter spacing." },
    {
      name: "selectedTier",
      type: "number",
      default: 0,
      description: "Highlight a price band, as if a tier had already been chosen. 0 for none.",
    },
  ];

  #sequence = 0;

  constructor() {
    super();
    this.productId = null;
    this.workingBranchId = null;
    this.heading = "";
    this.showCost = false;
    this.vatInclusive = false;
    this.dense = false;
    this.selectedTier = 0;
    this.detail = null;
  }

  updated(changed) {
    if (changed.has("productId") || changed.has("workingBranchId") || changed.has("api")) {
      this.fetch();
    }
  }

  async fetch() {
    if (this.productId == null) {
      this.detail = null;
      return;
    }
    const seq = ++this.#sequence;
    const result = await this.load(() =>
      this.client.getProductDetail({
        productId: this.productId,
        branchId: this.workingBranchId ?? undefined,
      }),
    );
    if (seq !== this.#sequence) return;
    this.detail = result ?? null;
    if (result?.product) {
      this.emit("merchant-product-detail-loaded", {
        productId: result.product.id,
        availability: result.availability,
        branchId: this.workingBranchId,
      });
    }
  }

  // The rate is per product (tax_rate joined on the row), not a constant — EXEMPT and ZERO
  // both exist and both mean "add nothing".
  get vatRate() {
    return Number(this.detail?.product?.tax_rate) || 0;
  }

  get showingVat() {
    return this.vatInclusive && this.vatRate > 0;
  }

  displayPence(pence) {
    return this.vatInclusive ? withVat(pence, this.vatRate) : pence;
  }

  pickPrice(uom, band) {
    this.selectedTier = band.tier;
    this.emit("merchant-product-price-selected", {
      productId: this.detail.product.id,
      productCode: this.detail.product.code,
      tier: band.tier,
      uomId: uom.uomId,
      per: uom.per,
      divisor: uom.divisor,
      // Always the ex-VAT figure, whatever is on screen. This is what an order line carries,
      // and letting a display toggle change what `pricePence` means would be a trap that only
      // shows up as a 20% error in someone else's total.
      pricePence: band.pricePence,
      pricePenceIncVat: withVat(band.pricePence, this.vatRate),
      vatRate: this.vatRate,
      shownIncVat: this.showingVat,
      qtyFrom: band.qtyFrom,
      qtyTo: band.qtyTo,
    });
  }

  // --- pieces ---------------------------------------------------------------

  renderSection(title, body, badge = nothing) {
    if (!body) return nothing;
    return html`
      <section>
        <h3
          class="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
        >
          ${title}${badge}
        </h3>
        ${body}
      </section>
    `;
  }

  // Flagged where the prices are read, not underneath them. A footnote below the figures is
  // read after the figure has already been quoted, and "£27.00" misheard as ex-VAT is a 20%
  // error going out of the door. Same amber as "Other branches" on purpose: both mean
  // "correct, but not the assumption you would otherwise make".
  //
  // Only the inclusive case is badged. Ex-VAT is what the trade counter expects, and badging
  // the expected state is noise that teaches people to ignore the badge.
  renderVatBadge() {
    if (!this.showingVat) return nothing;
    return html`<span
      part="vat-badge"
      class="${BADGE_BASE} ${BADGE.caution} normal-case"
      title="Selling prices below have VAT added at ${this.vatRate}%"
      >Includes VAT</span
    >`;
  }

  // A definition list rather than a table: rows are label/value pairs, and half of them are
  // absent on any given product.
  renderFacts(pairs) {
    const rows = pairs.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== 0);
    if (!rows.length) return null;
    return html`
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 ${this.dense ? "gap-y-0.5" : "gap-y-1"} text-sm">
        ${rows.map(
          ([k, v]) => html`
            <dt class="text-slate-500 dark:text-slate-400">${k}</dt>
            <dd class="text-slate-900 tabular-nums dark:text-slate-100">${v}</dd>
          `,
        )}
      </dl>
    `;
  }

  renderAvailability() {
    const { availability, otherBranches, product } = this.detail;
    const a = availabilityMeta(availability);
    return html`
      <div
        part="availability"
        class="rounded-merchant border border-slate-200 p-3 dark:border-slate-800"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="${BADGE_BASE} ${a.classes}">${a.label}</span>
          <span class="text-sm text-slate-600 dark:text-slate-300">${a.detail}</span>
        </div>
        ${otherBranches?.length
          ? html`<p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Carried at
              ${otherBranches.map(
                (b, i) => html`${i ? ", " : ""}<span class="font-medium text-slate-700 dark:text-slate-200"
                    >${b.name}</span
                  >`,
              )}${product.ranged_branches > otherBranches.length
                ? html` and ${product.ranged_branches - otherBranches.length} more`
                : nothing}.
            </p>`
          : nothing}
      </div>
    `;
  }

  // One block per unit of measure, not a tier x uom grid. A product priced both per sheet and
  // per 10m² has four bands in one and two in the other, so a grid would have holes and imply
  // prices that do not exist.
  renderPrices() {
    const { uoms, hasQuantityBreaks, product } = this.detail;
    if (!uoms.length) return this.renderEmpty("No prices held for this product.");

    return html`
      <div class="space-y-3">
        ${uoms.map(
          (uom) => html`
            <div class="overflow-hidden rounded-merchant border border-slate-200 dark:border-slate-800">
              <!--
                The unit lives in the Price column header rather than in a caption bar above
                it. "Priced each" as its own row said little that "Price each" does not, and
                the uom_type beside it ("sheet material") said nothing at all — it is a schema
                enum, not a fact about the product. One header row instead of two, and the
                unit still travels with the figures it qualifies, which is the part that
                matters when a line is priced two ways.
              -->
              <table class="w-full text-sm">
                <thead>
                  <tr
                    class="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400"
                  >
                    <th class="px-3 py-1.5 text-left font-medium">
                      ${hasQuantityBreaks ? "Quantity" : "Band"}
                    </th>
                    <th class="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                      Price <span class="text-slate-700 dark:text-slate-200">${perLabel(uom.per)}</span>
                    </th>
                    ${hasQuantityBreaks
                      ? html`<th class="px-3 py-1.5 text-right font-medium">Off</th>`
                      : nothing}
                  </tr>
                </thead>
                <tbody>
                  ${uom.bands.map((band) => this.renderBand(uom, band, hasQuantityBreaks))}
                </tbody>
              </table>
            </div>
          `,
        )}
        <p class="text-xs text-slate-500 dark:text-slate-400">
          ${hasQuantityBreaks
            ? html`Quantity breaks from <span class="font-medium">${product.price_break_name}</span>.`
            : // Saying which it is matters: "no quantity breaks" and "quantity breaks we are
              // not showing you" must not look the same at a counter.
              html`Customer price bands — this line has no quantity breaks.`}
          ${this.showingVat
            ? html`<span class="font-medium text-amber-700 dark:text-amber-300"
                >Prices include VAT at ${product.tax_rate}%.</span
              >`
            : this.vatInclusive
              ? // Asked for inclusive on a line that carries no VAT. Saying "includes VAT at
                // 0%" reads as a bug; naming the code says the same thing truthfully.
                html`No VAT on this line${product.tax_code ? html` (${product.tax_code})` : nothing}.`
              : html`Prices exclude VAT${product.tax_code
                  ? html` (${product.tax_code} ${product.tax_rate}%)`
                  : nothing}.`}
        </p>
      </div>
    `;
  }

  renderBand(uom, band, withQty) {
    const selected = this.selectedTier === band.tier;
    const qty =
      band.qtyFrom != null
        ? band.qtyTo != null
          ? `${band.qtyFrom}–${band.qtyTo}`
          : `${band.qtyFrom}+`
        : `Band ${band.tier}`;
    return html`
      <tr
        part=${selected ? "band band-selected" : "band"}
        class="cursor-pointer border-t border-slate-100 dark:border-slate-800
               ${selected
          ? "bg-accent-soft dark:bg-slate-700/60"
          : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}"
        @click=${() => this.pickPrice(uom, band)}
      >
        <td class="px-3 ${this.dense ? "py-0.5" : "py-1"} text-slate-700 dark:text-slate-200">
          ${withQty ? qty : `Band ${band.tier}`}
        </td>
        <td class="px-3 ${this.dense ? "py-0.5" : "py-1"} text-right font-medium tabular-nums">
          ${fmtPence(this.displayPence(band.pricePence))}
        </td>
        ${withQty
          ? html`<td class="px-3 ${this.dense ? "py-0.5" : "py-1"} text-right tabular-nums text-slate-500 dark:text-slate-400">
              ${band.discountPct ? `${band.discountPct}%` : ""}
            </td>`
          : nothing}
      </tr>
    `;
  }

  renderDimensions() {
    const p = this.detail.product;
    const mm = (v) => (v ? `${v} mm` : null);
    return this.renderFacts([
      ["Thickness", mm(p.thickness_mm)],
      ["Width", mm(p.width_mm)],
      ["Length", mm(p.length_mm)],
      // The mass unit itself is not recorded — weight_uom_id names the BASIS ("per each",
      // "per pack"), not kilograms. Printing the basis is truthful; inventing "kg" is not.
      ["Weight", p.weight ? `${p.weight}${p.weight_per ? ` per ${p.weight_per}` : ""}` : null],
      ["Coverage", p.pack_coverage_m2 ? `${p.pack_coverage_m2} m² per pack` : null],
    ]);
  }

  renderPackaging() {
    const p = this.detail.product;
    return this.renderFacts([
      ["Inner", p.qty_per_inner > 1 ? p.qty_per_inner : null],
      ["Outer", p.qty_per_outer > 1 ? p.qty_per_outer : null],
      ["Pallet", p.qty_per_pallet > 1 ? p.qty_per_pallet : null],
      ["Tally", p.tally_lengths?.length ? `${p.tally_description ?? ""} ${p.tally_lengths.join(", ")} m`.trim() : null],
    ]);
  }

  renderBarcodes() {
    const p = this.detail.product;
    const mono = (v) => (v ? html`<span class="font-mono text-xs">${v}</span>` : null);
    return this.renderFacts([
      ["Unit", mono(p.barcode_inner)],
      ["Outer", mono(p.barcode_outer)],
      ["Pallet", mono(p.barcode_pallet)],
    ]);
  }

  renderSupply() {
    const p = this.detail.product;
    return this.renderFacts([
      ["Supplier", p.supplier_name ? `${p.supplier_name}${p.supplier_town ? `, ${p.supplier_town}` : ""}` : null],
      ["Account", p.supplier_code],
      ["Source", p.source],
      ["Direct ex-works", p.allow_direct_ex_works ? "Allowed" : null],
    ]);
  }

  // Cost is not a counter fact. Off unless asked for, and flagged as ungated because the
  // dataset has no view_cost permission to gate it on.
  renderCost() {
    if (!this.showCost) return nothing;
    const p = this.detail.product;
    return this.renderSection(
      "Cost and margin",
      html`
        ${this.renderFacts([
          ["Last cost", fmtPence(p.last_cost_pence)],
          ["Average cost", fmtPence(p.weighted_average_cost_pence)],
          ["Margin band", p.low_margin || p.high_margin ? `${p.low_margin}% – ${p.high_margin}%` : null],
          ["Cost unit", p.cost_per],
        ])}
        <p class="mt-1 text-xs text-amber-700 dark:text-amber-300">
          Not permission-gated — no <span class="font-mono">view_cost</span> permission exists yet.
        </p>
      `,
    );
  }

  // `specification` is JSON, not prose: {"material": …, "source": …}. Rendering it raw put a
  // literal "{}" on the card, because an empty object is a truthy string.
  renderSpecification() {
    const raw = this.detail?.product?.specification;
    if (!raw || raw === "{}") return null;
    let spec;
    try {
      spec = JSON.parse(raw);
    } catch {
      return html`<p class="mt-3 text-sm text-slate-600 dark:text-slate-300">${raw}</p>`;
    }
    const entries = Object.entries(spec).filter(([, v]) => v);
    if (!entries.length) return null;
    return html`
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        ${entries.map(([k, v]) => {
          const label = k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
          const isUrl = typeof v === "string" && /^https?:\/\//.test(v);
          return html`
            <dt class="text-slate-500 dark:text-slate-400">${label}</dt>
            <dd class="text-slate-900 dark:text-slate-100">
              ${isUrl
                ? html`<a
                    href=${v}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-sky-700 underline hover:no-underline dark:text-sky-300"
                    >${new URL(v).hostname}</a
                  >`
                : String(v)}
            </dd>
          `;
        })}
      </dl>
    `;
  }

  render() {
    if (this.productId == null) return this.renderEmpty("No product — set productId.");
    if (this.error) return this.renderError(this.error, { onRetry: () => this.fetch() });
    if (this.loading && !this.detail) return this.renderSkeleton(4);
    if (!this.detail?.product) return this.loading ? this.renderSkeleton(4) : this.renderEmpty("Product not found.");

    const p = this.detail.product;

    return html`
      <article part="root" class="text-slate-900 dark:text-slate-100">
        ${this.heading
          ? html`<h2 class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              ${this.heading}
            </h2>`
          : nothing}

        <header part="identity" class="mb-3">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <span class="font-mono text-xs text-slate-500 dark:text-slate-400">${p.code}</span>
            ${p.status !== "active"
              ? html`<span class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200"
                  >${p.status}</span
                >`
              : nothing}
          </div>
          <h1 class="text-lg leading-tight font-semibold">${p.name}</h1>
          <p class="mt-0.5 font-mono text-xs text-slate-400 dark:text-slate-500">${p.group_path}</p>
        </header>

        ${this.renderAvailability()}

        <!--
          Price beside the facts once there is room for it, stacked when there is not.

          The price tables are narrow by nature — two or three columns of figures — so giving
          them the full width of a wide card left "Band 1 ........ £22.50" stretched across
          900px of nothing while dimensions and supply queued up underneath. A capped column
          keeps the figures together and puts the reference facts alongside instead.

          All three breakpoints measure the same container (:host is the only element with
          container-type), so they are widths of the CARD, not of the window. No property:
          the component can see how much room it has been given.
        -->
        <div class="mt-3 grid items-start gap-4 @3xl:grid-cols-[minmax(0,24rem)_1fr] @3xl:gap-6">
          ${this.renderSection("Selling prices", this.renderPrices(), this.renderVatBadge())}
          <!--
            The facts stay a single stack at every width. They are label/value pairs whose
            values are of unpredictable length — "Howarth Timber, London", "Kiln Dried
            Softwood Carcassing" — and splitting them into ~290px columns makes those wrap
            after the first word. The horizontal saving has already been taken by moving the
            price out beside them; a third column only adds busyness.
          -->
          <div class="grid gap-4">
            ${this.renderSection("Dimensions", this.renderDimensions())}
            ${this.renderSection("Packaging", this.renderPackaging())}
            ${this.renderSection("Barcodes", this.renderBarcodes())}
            ${this.renderSection("Supply", this.renderSupply())}
            ${this.renderSection("Specification", this.renderSpecification())}
            ${this.renderCost()}
          </div>
        </div>
        ${p.updated_at
          ? html`<p class="mt-3 text-xs text-slate-400 dark:text-slate-500">
              Last updated ${fmtDate(p.updated_at)}
            </p>`
          : nothing}
      </article>
    `;
  }
}

customElements.define("merchant-product-detail", MerchantProductDetail);
