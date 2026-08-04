// qty-input v0.1.0 — how much, in the units the trade actually uses.
//
// This is where merchant software separates from packaged ERP. Every system sells "6 bolts
// at £2.50 = £15.00". Rather fewer handle a pallet of 366 bricks priced per 1,000. Almost
// none handle a timber tally — a list of lengths, each with a piece count, totalling to
// cubic metres — and fewer still handle hardwood, where every parcel is a different width
// and length and the volume is worked out board by board.
//
// Five entry modes, one output. Whatever is typed, the component emits a single priced
// quantity in the pricing unit of measure, plus the detail behind it, so the order line can
// carry both "3.482 m³" and the tally that produced it.
//
//   unit            6 × £2.50 = £15.00
//   pack            1 pallet = 366 bricks, priced per 1,000
//   sheet           sheets, with the area they cover
//   tally_fixed     pieces against a known list of lengths (2.4, 3.0, 3.6 …)
//   tally_variable  hardwood — measured parcel by parcel, random width and length

import { html, css, nothing } from "lit";
import { MerchantElement } from "../shared/merchant-element.js";
import { fmtPence } from "../shared/format.js";
import {
  toMetres,
  totalPieces,
  totalLinearM,
  totalVolumeM3,
  pricedQuantity,
  lineTotalPence,
} from "../shared/quantity.js";

const MODE_LABEL = {
  unit: "Quantity",
  pack: "Packs",
  sheet: "Sheets",
  tally_fixed: "Tally",
  tally_variable: "Tally — measured",
};

export class MerchantQtyInput extends MerchantElement {
  static version = "0.1.0";

  static styles = [
    ...MerchantElement.styles,
    css`
      :host {
        container-type: inline-size;
        display: block;
      }
      /* Number inputs in a tally grid are read as a column of figures, so they line up. */
      input[type="number"] {
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  static properties = {
    productId: { type: Number, attribute: "product-id" },
    uomId: { type: Number, attribute: "uom-id" },
    tier: { type: Number },
    // Lets a fixed tally be demonstrated: product.tally_id is 0 for every product in the
    // dataset, so nothing links to the tally table yet.
    tallyLengths: { attribute: "tally-lengths", converter: {
      fromAttribute: (v) => (v ? v.split(",").map(Number).filter((n) => n > 0) : null),
      toAttribute: (v) => (Array.isArray(v) ? v.join(",") : null),
    } },
    packSize: { type: Number, attribute: "pack-size" },
    // Hardwood is random width — every board differs, so width is entered per line. A
    // softwood pack is a fixed section (25 x 50) with only the lengths varying, and showing
    // a width column there invites someone to type into it and quietly change the price.
    randomWidth: { type: Boolean, attribute: "random-width" },
    packs: { type: Number },
    heading: { type: String },
    config: { attribute: false, state: true },
    lines: { attribute: false, state: true },
    simpleQty: { state: true },
  };

  static harnessSchema = [
    {
      name: "productId",
      type: "number",
      default: 1,
      description:
        "Product to price. Try a sheet material (dual-priced per sheet and per 10m²) or a hardwood, which is priced per m³ and measured parcel by parcel.",
    },
    {
      name: "tallyLengths",
      type: "csv",
      default: null,
      description:
        "Override with a fixed length list, e.g. 2.4,3,3.6,4.2,4.8. No product references the tally table yet (tally_id is 0 for all 3,714), so this is how the fixed-tally mode is exercised.",
    },
    {
      name: "packSize",
      type: "number",
      default: null,
      description:
        "Units per pack, e.g. 366 for a brick pallet. Overrides the product's own figure — no price row in the dataset uses a divisor above 1.",
    },
    {
      name: "randomWidth",
      type: "boolean",
      default: true,
      description:
        "Width varies per board (hardwood). Off for a fixed section like 25x50, where only the lengths vary — a random-length softwood pack.",
    },
    {
      name: "packs",
      type: "number",
      default: 1,
      description:
        "Multiplies a tally, for packs of a repeated make-up: 4 packs of the same 80-piece tally.",
    },
    { name: "tier", type: "number", default: 1, description: "Price tier to quote against." },
    { name: "heading", type: "string", default: "", description: "Visible heading. Blank hides it." },
  ];

  constructor() {
    super();
    this.productId = null;
    this.uomId = null;
    this.tier = 1;
    this.tallyLengths = null;
    this.packSize = null;
    this.randomWidth = true;
    this.packs = 1;
    this.heading = "";
    this.config = null;
    this.lines = [];
    this.simpleQty = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchConfig();
  }

  updated(changed) {
    if (changed.has("productId") || changed.has("api")) this.fetchConfig();
    if (changed.has("tallyLengths") || changed.has("packSize")) this.resetLines();
  }

  async fetchConfig() {
    if (!this.productId) {
      this.config = null;
      return;
    }
    const result = await this.load(() => this.client.getQtyConfig({ productId: this.productId }));
    if (!result) return;
    this.config = result;
    if (this.uomId == null) this.uomId = result.uoms[0]?.uomId ?? null;
    this.resetLines();
  }

  // --- the shape of the thing being priced -----------------------------------

  get mode() {
    if (this.tallyLengths?.length) return "tally_fixed";
    if (this.packSize > 1) return "pack";
    return this.config?.mode ?? "unit";
  }

  get uom() {
    return this.config?.uoms.find((u) => u.uomId === this.uomId) ?? this.config?.uoms[0] ?? null;
  }

  get unitPricePence() {
    const tiers = this.uom?.tiers ?? [];
    return (tiers.find((t) => t.tier === this.tier) ?? tiers[0])?.pricePence ?? 0;
  }

  get lengths() {
    return this.tallyLengths?.length ? this.tallyLengths : (this.config?.product.tally_lengths ?? []);
  }

  get effectivePackSize() {
    return this.packSize > 1
      ? this.packSize
      : Math.max(this.config?.product.qty_per_pallet ?? 1, this.config?.product.qty_per_outer ?? 1);
  }

  resetLines() {
    const mode = this.mode;
    if (mode === "tally_fixed") {
      this.lines = this.lengths.map((length) => ({ length, pieces: 0 }));
    } else if (mode === "tally_variable") {
      // Hardwood starts with one blank parcel; width defaults to the product's nominal.
      this.lines = [this.blankParcel()];
    } else {
      this.lines = [];
      this.simpleQty = 0;
    }
    this.publish();
  }

  blankParcel() {
    return { pieces: 0, length: 0, widthMm: this.config?.product.width_mm ?? 0 };
  }

  // --- the maths --------------------------------------------------------------
  //
  // One number comes out: the quantity in the pricing unit. How it is reached depends on the
  // mode, and getting the conversion wrong is the difference between selling a cubic metre
  // of oak and a thousandth of one.

  get thicknessM() {
    return toMetres(this.config?.product.thickness_mm);
  }

  get sheetAreaM2() {
    const p = this.config?.product;
    return toMetres(p?.width_mm) * toMetres(p?.length_mm);
  }

  get packMultiplier() {
    return Math.max(Number(this.packs) || 1, 1);
  }

  get totalPieces() {
    return totalPieces(this.lines) * this.packMultiplier;
  }

  get totalLinearM() {
    return totalLinearM(this.lines) * this.packMultiplier;
  }

  get totalVolumeM3() {
    return (
      totalVolumeM3(this.lines, {
        widthMm: this.config?.product.width_mm,
        thicknessMm: this.config?.product.thickness_mm,
      }) * this.packMultiplier
    );
  }

  // The number the price is multiplied by. Arithmetic lives in shared/quantity.js.
  get pricedQuantity() {
    return pricedQuantity({
      mode: this.mode,
      per: this.uom?.per,
      simpleQty: this.simpleQty,
      lines: this.lines,
      product: this.config?.product ?? {},
      packSize: this.effectivePackSize,
      divisor: this.uom?.divisor,
      packs: this.packMultiplier,
    });
  }

  get totalPence() {
    return lineTotalPence(this.pricedQuantity, this.unitPricePence);
  }

  publish() {
    this.emit("merchant-qty-changed", {
      productId: this.productId,
      mode: this.mode,
      uomId: this.uomId,
      per: this.uom?.per ?? null,
      // What the price is multiplied by, in the pricing unit.
      quantity: Number(this.pricedQuantity.toFixed(6)),
      unitPricePence: this.unitPricePence,
      totalPence: this.totalPence,
      // The working, so the order line can show the tally that produced the volume.
      pieces: this.mode.startsWith("tally") ? this.totalPieces : null,
      linearM: this.mode.startsWith("tally") ? Number(this.totalLinearM.toFixed(3)) : null,
      volumeM3: this.mode.startsWith("tally") ? Number(this.totalVolumeM3.toFixed(4)) : null,
      lines: this.mode.startsWith("tally") ? this.lines.filter((l) => Number(l.pieces) > 0) : null,
    });
  }

  setLine(index, field, value) {
    const lines = [...this.lines];
    lines[index] = { ...lines[index], [field]: value === "" ? 0 : Number(value) };
    this.lines = lines;
    this.publish();
  }

  addParcel() {
    this.lines = [...this.lines, this.blankParcel()];
  }

  removeParcel(index) {
    this.lines = this.lines.filter((_, i) => i !== index);
    this.publish();
  }

  setSimple(value) {
    this.simpleQty = value === "" ? 0 : Number(value);
    this.publish();
  }

  // --- rendering --------------------------------------------------------------

  numberField(value, onInput, { step = "1", label = "", width = "w-24" } = {}) {
    return html`<input
      type="number"
      min="0"
      step=${step}
      aria-label=${label}
      .value=${value === 0 ? "" : String(value)}
      placeholder="0"
      class="${width} rounded-merchant border border-slate-300 px-2 py-1 text-right text-sm
             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
             dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      @input=${(e) => onInput(e.target.value)}
    />`;
  }

  renderUomChoice() {
    const uoms = this.config?.uoms ?? [];
    if (uoms.length < 2) return nothing;
    // 266 products are priced in more than one unit — a sheet by the sheet or by area. The
    // counter chooses, because the customer asks in one or the other.
    return html`
      <div part="uom-choice" class="mb-2 flex flex-wrap items-center gap-1 text-xs">
        <span class="text-slate-500 dark:text-slate-400">Price by</span>
        ${uoms.map(
          (u) => html`<button
            type="button"
            class="rounded px-2 py-0.5 font-medium ${u.uomId === this.uomId
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}"
            @click=${() => {
              this.uomId = u.uomId;
              this.publish();
            }}
          >
            ${u.per}
          </button>`,
        )}
      </div>
    `;
  }

  renderSimple() {
    const mode = this.mode;
    const dp = this.uom?.inputDp ?? 0;
    const step = dp > 0 ? `0.${"0".repeat(dp - 1)}1` : "1";
    const packSize = this.effectivePackSize;

    return html`
      <div class="flex flex-wrap items-end gap-2">
        <label class="text-xs text-slate-500 dark:text-slate-400">
          <span class="mb-1 block">${MODE_LABEL[mode]}</span>
          ${this.numberField(this.simpleQty, (v) => this.setSimple(v), { step, label: MODE_LABEL[mode] })}
        </label>
        ${mode === "pack" && packSize > 1
          ? html`<span class="pb-1.5 text-xs text-slate-500 dark:text-slate-400"
              >× ${packSize} = <span class="font-medium">${(this.simpleQty * packSize).toLocaleString("en-GB")}</span></span
            >`
          : nothing}
        ${mode === "sheet" && this.sheetAreaM2
          ? html`<span class="pb-1.5 text-xs text-slate-500 dark:text-slate-400"
              >${this.sheetAreaM2.toFixed(3)} m² each ·
              <span class="font-medium">${(this.simpleQty * this.sheetAreaM2).toFixed(2)} m²</span></span
            >`
          : nothing}
      </div>
    `;
  }

  renderFixedTally() {
    const per = this.uom?.per;
    return html`
      <table part="tally" class="w-full text-left text-sm">
        <thead>
          <tr class="text-xs text-slate-500 dark:text-slate-400">
            <th class="pb-1 font-medium">Length</th>
            <th class="pb-1 text-right font-medium">Pieces</th>
            <th class="pb-1 text-right font-medium">${per === "m3" ? "m³" : "Metres"}</th>
          </tr>
        </thead>
        <tbody>
          ${this.lines.map((line, i) => {
            const width = (this.config.product.width_mm ?? 0) / 1000;
            const rowValue =
              per === "m3"
                ? (line.pieces || 0) * line.length * width * this.thicknessM
                : (line.pieces || 0) * line.length;
            return html`
              <tr class="border-t border-slate-100 dark:border-slate-800">
                <td class="py-1 font-mono">${line.length.toFixed(1)} m</td>
                <td class="py-1 text-right">
                  ${this.numberField(line.pieces, (v) => this.setLine(i, "pieces", v), {
                    label: `Pieces at ${line.length} m`,
                    width: "w-20",
                  })}
                </td>
                <td class="py-1 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  ${rowValue ? rowValue.toFixed(per === "m3" ? 4 : 2) : "—"}
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    `;
  }

  renderVariableTally() {
    // Hardwood: every parcel is a different width and length, so both are entered. Thickness
    // is the product's — you buy 25mm oak, and the board is whatever width the tree gave.
    return html`
      <table part="tally" class="w-full text-left text-sm">
        <thead>
          <tr class="text-xs text-slate-500 dark:text-slate-400">
            <th class="pb-1 font-medium">Pieces</th>
            <th class="pb-1 font-medium">Length (m)</th>
            ${this.randomWidth ? html`<th class="pb-1 font-medium">Width (mm)</th>` : nothing}
            <th class="pb-1 text-right font-medium">m³</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.lines.map((line, i) => {
            const vol =
              (line.pieces || 0) * (line.length || 0) * ((line.widthMm || 0) / 1000) * this.thicknessM;
            return html`
              <tr class="border-t border-slate-100 dark:border-slate-800">
                <td class="py-1">
                  ${this.numberField(line.pieces, (v) => this.setLine(i, "pieces", v), { width: "w-20", label: "Pieces" })}
                </td>
                <td class="py-1">
                  ${this.numberField(line.length, (v) => this.setLine(i, "length", v), { step: "0.001", width: "w-24", label: "Length in metres" })}
                </td>
                ${this.randomWidth
                  ? html`<td class="py-1">
                      ${this.numberField(line.widthMm, (v) => this.setLine(i, "widthMm", v), { width: "w-24", label: "Width in millimetres" })}
                    </td>`
                  : nothing}
                <td class="py-1 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  ${vol ? vol.toFixed(4) : "—"}
                </td>
                <td class="py-1 pl-1 text-right">
                  ${this.lines.length > 1
                    ? html`<button
                        type="button"
                        class="text-xs text-slate-400 hover:text-red-600"
                        aria-label="Remove parcel"
                        @click=${() => this.removeParcel(i)}
                      >
                        ✕
                      </button>`
                    : nothing}
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
      <button
        type="button"
        part="add-parcel"
        class="mt-1 text-xs font-medium text-sky-700 hover:underline dark:text-sky-300"
        @click=${() => this.addParcel()}
      >
        Add parcel
      </button>
    `;
  }

  renderTotal() {
    const per = this.uom?.per ?? "each";
    const qty = this.pricedQuantity;
    const isTally = this.mode.startsWith("tally");

    return html`
      <div
        part="total"
        class="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-200 pt-2 dark:border-slate-800"
      >
        <span class="text-xs text-slate-500 dark:text-slate-400">
          ${isTally
            ? html`${this.totalPieces} ${this.totalPieces === 1 ? "piece" : "pieces"} ·
                ${this.totalLinearM.toFixed(2)} m
                ${this.thicknessM ? html`· ${this.totalVolumeM3.toFixed(4)} m³` : nothing}`
            : nothing}
        </span>
        <span class="font-mono text-sm tabular-nums">
          <span class="text-slate-500 dark:text-slate-400"
            >${qty ? qty.toFixed(this.uom?.inputDp ?? 0) : "0"} ${per} ×
            ${fmtPence(this.unitPricePence)}</span
          >
          =
          <span class="font-semibold text-slate-900 dark:text-slate-100">${fmtPence(this.totalPence)}</span>
        </span>
      </div>
    `;
  }

  render() {
    if (!this.productId) return this.renderEmpty("No product — set productId.");
    if (this.error) return this.renderError(this.error, { onRetry: () => this.fetchConfig() });
    if (!this.config) return this.renderSkeleton(2);

    const mode = this.mode;
    const p = this.config.product;

    return html`
      <section
        part="root"
        class="rounded-merchant border border-slate-200 bg-white p-3 text-slate-900
               dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        ${this.heading
          ? html`<h2 part="heading" class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">${this.heading}</h2>`
          : nothing}

        <p class="mb-2 flex flex-wrap items-baseline gap-2 text-sm">
          <span class="font-mono text-xs text-slate-500 dark:text-slate-400">${p.code}</span>
          <span class="font-medium">${p.name}</span>
          <span
            class="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >${MODE_LABEL[mode]}</span
          >
        </p>

        ${this.renderUomChoice()}
        ${mode.startsWith("tally")
          ? html`<label class="mb-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Packs of this make-up</span>
              ${this.numberField(this.packs, (v) => {
                this.packs = Number(v) || 1;
                this.publish();
              }, { width: "w-16", label: "Number of packs" })}
              ${this.packMultiplier > 1
                ? html`<span class="font-medium">× the tally below</span>`
                : nothing}
            </label>`
          : nothing}
        ${mode === "tally_fixed"
          ? this.renderFixedTally()
          : mode === "tally_variable"
            ? this.renderVariableTally()
            : this.renderSimple()}
        ${this.renderTotal()}
      </section>
    `;
  }
}

customElements.define("merchant-qty-input", MerchantQtyInput);
