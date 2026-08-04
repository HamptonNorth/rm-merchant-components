// find-product v0.1.0 — the catalogue, seen from one branch.
//
// The customer search answers "who is this". This answers "can I sell you this, from here,
// today", and that second question is the one a counter hand actually has. A product search
// that returns a hit without saying whether the yard carries it is worse than one that finds
// nothing: it invites someone to promise stock that has never been on site.
//
// So every row carries an availability state (requirements-product-ranging.md), and the
// ordering follows it — what can be sold now, then what can be obtained, then what cannot be
// sold here at all. Blocked lines are shown greyed rather than hidden, because "why can I
// not find it" is a worse counter experience than seeing it with a reason attached.
//
// One box, routed by what was typed. The shapes overlap far more than they do for customers:
//   0442BBBPLY      a product code, matched as a prefix
//   5055149904301   a barcode, from a scanner
//   birch ply       a name — tokens ANDed in any order, so "ply birch" finds the same thing
//
// Nobody chooses a mode first. Code and name are matched in the same query and the row says
// which one hit.

import { html, css, nothing } from "lit";
import { MerchantElement } from "../shared/merchant-element.js";
import { fmtPence } from "../shared/format.js";

const SCOPES = ["branch", "all"];

const SCOPE_LABEL = {
  branch: "this branch's range",
  all: "the whole catalogue",
};

// Colour carries the meaning here, so it is defined once rather than inline per branch of a
// template. Green reads as "yes, now"; amber as "yes, but not from this yard"; red as "no".
const AVAILABILITY = {
  held: {
    label: "In range",
    hint: "Carried at this branch",
    classes: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  },
  to_order: {
    label: "To order",
    hint: "Sold here, obtained per order",
    classes: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  },
  elsewhere: {
    label: "Other branches",
    hint: "Not ranged here, carried elsewhere in the network",
    classes: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  },
  special_order: {
    label: "Special order",
    hint: "Ranged nowhere — orderable from the supplier",
    classes: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
  blocked: {
    label: "Not permitted",
    hint: "This branch may not sell this line",
    classes: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  },
};

// "10m2" is how the unit-of-measure table spells it; nobody writes it that way on a quote.
const PER_LABEL = {
  "10m2": "per 10m²",
  m2: "per m²",
  m3: "per m³",
  "cu ft": "per cu ft",
  mtr: "per metre",
  "100 mtr": "per 100m",
  each: "each",
  pair: "per pair",
  litre: "per litre",
  kg: "per kg",
  dozen: "per dozen",
  pallet: "per pallet",
  pack: "per pack",
};

export class MerchantFindProduct extends MerchantElement {
  static version = "0.1.0";

  static styles = [
    ...MerchantElement.styles,
    css`
      :host {
        container-type: inline-size;
        display: block;
      }
    `,
  ];

  static properties = {
    workingBranchId: { type: Number, attribute: "working-branch-id" },
    scope: { type: String },
    groupPath: { type: String, attribute: "group-path" },
    limit: { type: Number },
    heading: { type: String },
    placeholder: { type: String },
    dense: { type: Boolean },
    zebra: { type: Boolean },
    showGroupFilter: { type: Boolean, attribute: "show-group-filter" },
    collapseOnSelect: { type: Boolean, attribute: "collapse-on-select" },
    selectedRow: { attribute: false, state: true },
    term: { state: true },
    results: { attribute: false, state: true },
    groups: { attribute: false, state: true },
    summary: { attribute: false, state: true },
    route: { state: true },
    activeIndex: { state: true },
    searching: { state: true },
    matchCount: { state: true },
    truncated: { state: true },
  };

  static harnessSchema = [
    {
      name: "workingBranchId",
      type: "number",
      default: 13,
      description:
        "The branch this counter is working from, from <merchant-working-branch>. Branch 13 (Leeds) is the specialist branch — it ranges a whole category the others only obtain, so it is where the availability states differ most.",
    },
    {
      name: "scope",
      type: "select",
      options: SCOPES,
      default: "branch",
      description:
        "branch searches only what this branch ranges; all searches the catalogue and still reports each product's state here. Widening is how you find something orderable.",
    },
    {
      name: "heading",
      type: "string",
      default: "Find product",
      description: "Visible heading. Blank hides it.",
    },
    {
      name: "placeholder",
      type: "string",
      default: "Code, name or barcode",
      description: "Input placeholder.",
    },
    {
      name: "showGroupFilter",
      type: "boolean",
      default: true,
      description:
        "Product-group filter. Narrows to a group and everything beneath it — picking Top.Timber includes Top.Timber.Joinery.Sawn.",
    },
    {
      name: "collapseOnSelect",
      type: "boolean",
      default: false,
      description: "Hide the results once a product is picked. For a flow, where the search has done its job.",
    },
    { name: "dense", type: "boolean", default: false, description: "Tighter rows — more results without scrolling." },
    {
      name: "zebra",
      type: "boolean",
      default: false,
      description: "Alternating row shading. Worth turning on with dense.",
    },
    { name: "limit", type: "number", default: 25, description: "Rows to return. The API caps at 500." },
  ];

  #debounce = null;
  #sequence = 0;

  constructor() {
    super();
    this.workingBranchId = null;
    this.scope = "branch";
    this.groupPath = "";
    this.limit = 25;
    this.heading = "Find product";
    this.placeholder = "Code, name or barcode";
    this.dense = false;
    this.zebra = false;
    this.showGroupFilter = true;
    this.collapseOnSelect = false;
    this.selectedRow = null;
    this.term = "";
    this.results = [];
    this.groups = [];
    this.summary = null;
    this.route = "none";
    this.activeIndex = -1;
    this.searching = false;
    this.matchCount = 0;
    this.truncated = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadFacets();
  }

  updated(changed) {
    if (changed.has("workingBranchId") || changed.has("api")) this.loadFacets();
    if (
      changed.has("scope") ||
      changed.has("workingBranchId") ||
      changed.has("groupPath") ||
      changed.has("api")
    ) {
      if (this.term) this.search({ immediate: true });
    }
  }

  // The range summary is what makes an empty branch-scoped result explain itself: "1,736 of
  // 3,714 ranged here" says immediately that the branch is the constraint, not the search.
  async loadFacets() {
    if (this.workingBranchId == null) return;
    const branchId = this.workingBranchId;
    const [groups, summary] = await Promise.all([
      this.showGroupFilter
        ? this.client.listProductGroups({ branchId }).catch(() => null)
        : Promise.resolve(null),
      this.client.getRangeSummary({ branchId }).catch(() => null),
    ]);
    // A branch change mid-flight must not land stale facets.
    if (branchId !== this.workingBranchId) return;
    if (groups) this.groups = groups.rows ?? [];
    if (summary) this.summary = summary.summary ?? null;
  }

  onInput(event) {
    this.term = event.target.value;
    this.search();
  }

  search({ immediate = false } = {}) {
    clearTimeout(this.#debounce);
    // A barcode scanner types the whole code in a burst and ends with Enter, so the debounce
    // has to be short enough not to sit between the scan and the search.
    this.#debounce = setTimeout(() => this.runSearch(), immediate ? 0 : 180);
  }

  async runSearch() {
    const term = this.term.trim();
    if (!term) {
      this.results = [];
      this.route = "none";
      this.activeIndex = -1;
      this.matchCount = 0;
      this.truncated = false;
      return;
    }

    this.selectedRow = null;
    const seq = ++this.#sequence;
    this.searching = true;
    const result = await this.load(() =>
      this.client.searchProducts({
        term,
        branchId: this.workingBranchId ?? undefined,
        scope: this.scope,
        groupPath: this.groupPath || undefined,
        limit: this.limit,
      }),
    );
    if (seq !== this.#sequence) return;

    this.searching = false;
    this.results = result?.rows ?? [];
    this.route = result?.route ?? "none";
    this.matchCount = result?.matchCount ?? this.results.length;
    this.truncated = Boolean(result?.truncated);
    // A barcode resolves to exactly one product, so pre-arm it for the Enter that the
    // scanner itself sends.
    this.activeIndex = this.route === "barcode" && this.results.length ? 0 : -1;
  }

  onKeyDown(event) {
    if (!this.results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.activeIndex = Math.min(this.activeIndex + 1, this.results.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, 0);
    } else if (event.key === "Enter" && this.activeIndex >= 0) {
      event.preventDefault();
      this.select(this.results[this.activeIndex]);
    } else if (event.key === "Escape") {
      this.term = "";
      this.results = [];
      this.route = "none";
    }
  }

  select(row) {
    // A blocked line is not selectable. Letting it through would put a product on an order
    // the branch is not allowed to sell, which is the one outcome this state exists to stop.
    if (row.availability === "blocked") return;
    this.selectedRow = row;
    this.activeIndex = this.results.indexOf(row);
    this.emit("merchant-product-selected", {
      product: row,
      availability: row.availability,
      branchId: this.workingBranchId,
      scope: this.scope,
    });
  }

  widen() {
    if (this.scope === "branch") {
      this.scope = "all";
      this.emit("merchant-product-search-widened", { scope: this.scope, term: this.term });
    }
  }

  narrow() {
    if (this.scope !== "branch") this.scope = "branch";
  }

  reopen() {
    this.selectedRow = null;
  }

  onGroupChange(event) {
    this.groupPath = event.target.value;
  }

  // Price, unit and the multi-unit marker are one non-breaking group. Spaced apart they read
  // as separate facts and the marker looks like a typo — "£18.50 each + Panel Products
  // Distribution" parses as a conjunction rather than a footnote.
  renderPrice(row) {
    if (row.price_pence === null || row.price_pence === undefined) return nothing;
    const per = PER_LABEL[row.price_per] ?? (row.price_per ? `per ${row.price_per}` : "");
    return html`<span class="whitespace-nowrap">
      <span class="font-medium text-slate-900 tabular-nums dark:text-slate-100"
        >${fmtPence(row.price_pence)}</span
      >${per ? html`<span class="ml-1 text-slate-500 dark:text-slate-400">${per}</span>` : nothing}${row.price_varies
        ? html`<sup
            class="ml-0.5 font-medium text-amber-700 dark:text-amber-300"
            title="Also priced in another unit at higher quantity breaks — open the product before quoting"
            >&#8225;</sup
          >`
        : nothing}
    </span>`;
  }

  renderAvailability(row) {
    const a = AVAILABILITY[row.availability] ?? AVAILABILITY.special_order;
    // The branch count is the actionable half of "not here": one branch away is a transfer,
    // ranged nowhere is a supplier order, and they are different conversations. The count
    // replaces the label rather than appending to it — "Other branches · 10 branches" says
    // the word twice, and that width squeezed every product name onto two lines.
    const label =
      row.availability === "elsewhere"
        ? `At ${row.ranged_branches} ${row.ranged_branches === 1 ? "branch" : "branches"}`
        : a.label;
    return html`<span
      class="rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${a.classes}"
      title=${a.hint}
      >${label}</span
    >`;
  }

  renderRow(row, index) {
    const active = index === this.activeIndex;
    const blocked = row.availability === "blocked";
    const stripe = this.zebra ? "odd:bg-slate-500/5" : "";

    return html`
      <li class=${stripe}>
        <button
          part=${active ? "result result-active" : "result"}
          type="button"
          role="option"
          aria-selected=${active ? "true" : "false"}
          aria-disabled=${blocked ? "true" : "false"}
          class="w-full border-b border-l-2 border-slate-100 text-left last:border-b-0
                 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent
                 dark:border-b-slate-800
                 ${this.dense ? "px-3 py-1" : "px-3 py-2"}
                 ${blocked ? "cursor-not-allowed opacity-60" : ""}
                 ${active
            ? "border-l-accent bg-accent-soft dark:bg-slate-700/60"
            : "border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60"}"
          @click=${() => this.select(row)}
          @mousemove=${() => (this.activeIndex = index)}
        >
          <span class="flex items-baseline gap-x-2 ${this.dense ? "leading-snug" : ""}">
            <span class="min-w-0 flex-1">
              <span class="font-mono text-xs text-slate-500 dark:text-slate-400">${row.code}</span>
              <span class="ml-2 font-medium text-slate-900 dark:text-slate-100">${row.name}</span>
            </span>
            <span class="shrink-0">${this.renderAvailability(row)}</span>
          </span>
          <span
            class="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500 dark:text-slate-400
                   ${this.dense ? "leading-snug" : "mt-0.5"}"
          >
            ${this.renderPrice(row)}
            <span>${row.supplier_name}</span>
            <span class="font-mono opacity-70">${row.group_path}</span>
          </span>
        </button>
      </li>
    `;
  }

  renderSelected() {
    const row = this.selectedRow;
    const a = AVAILABILITY[row.availability] ?? AVAILABILITY.special_order;
    return html`
      <div
        part="selected"
        class="mt-2 rounded-merchant border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="flex items-baseline gap-x-2">
          <span class="min-w-0 flex-1">
            <span class="font-mono text-xs text-slate-500 dark:text-slate-400">${row.code}</span>
            <span class="ml-2 font-medium">${row.name}</span>
          </span>
          <span class="shrink-0">${this.renderAvailability(row)}</span>
        </div>
        <div class="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500 dark:text-slate-400">
          ${this.renderPrice(row)}
          <span>${row.supplier_name}</span>
        </div>
        <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
          ${a.hint}.
          <button
            part="reopen"
            type="button"
            class="ml-1 font-medium text-sky-700 underline hover:no-underline dark:text-sky-300"
            @click=${() => this.reopen()}
          >
            Change
          </button>
        </p>
      </div>
    `;
  }

  renderCount() {
    if (this.selectedRow) return nothing;
    if (this.route === "none" || this.route === "too_short" || !this.results.length) return nothing;
    const shown = this.results.length;
    const total = Math.max(this.matchCount, shown);
    const fmt = (n) => n.toLocaleString("en-GB");
    if (!this.truncated) return html`· ${fmt(shown)} ${shown === 1 ? "match" : "matches"}`;
    return html`·
      <span class="font-medium text-amber-700 dark:text-amber-300"
        >${fmt(shown)} of ${fmt(total)} matches</span
      >
      — narrow the search to see the rest`;
  }

  renderGroupFilter() {
    if (!this.showGroupFilter || !this.groups.length) return nothing;
    // Only groups the branch actually ranges something in, when scoped to the branch — a
    // filter offering groups that can only ever return nothing teaches people to ignore it.
    const useful =
      this.scope === "branch" ? this.groups.filter((g) => g.ranged_count > 0) : this.groups;
    return html`
      <select
        part="group-filter"
        class="rounded-merchant border border-slate-300 bg-white px-2 py-1 text-xs
               dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        .value=${this.groupPath}
        @change=${(e) => this.onGroupChange(e)}
      >
        <option value="">All groups</option>
        ${useful.map(
          (g) => html`<option value=${g.path}>
            ${g.path} (${this.scope === "branch" ? g.ranged_count : g.product_count})
          </option>`,
        )}
      </select>
    `;
  }

  renderHint() {
    if (this.route === "too_short") return "Keep typing — 3 characters for a name, 2 for a code.";
    if (this.route === "none") return "Type a product code or name, or scan a barcode.";
    return null;
  }

  renderEmptyResult() {
    // The distinction that matters: nothing here versus nothing anywhere. Only the first is
    // worth widening for, and saying so saves a pointless second search.
    if (this.scope === "branch") {
      return html`Nothing in ${SCOPE_LABEL.branch} matches.
        <button
          type="button"
          class="font-medium text-sky-700 underline hover:no-underline dark:text-sky-300"
          @click=${() => this.widen()}
        >
          Search the whole catalogue
        </button>
        — it may still be orderable.`;
    }
    return html`Nothing in the catalogue matches.`;
  }

  render() {
    if (this.scope === "branch" && this.workingBranchId == null) {
      return this.renderEmpty("No working branch — set workingBranchId, or use scope=all.");
    }

    const hint = this.renderHint();

    return html`
      <section part="root" class="text-slate-900 dark:text-slate-100">
        ${this.heading
          ? html`<h2
              part="heading"
              class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
            >
              ${this.heading}
            </h2>`
          : nothing}

        <div class="flex flex-wrap items-center gap-2">
          <input
            part="input"
            type="search"
            role="combobox"
            aria-expanded=${this.results.length ? "true" : "false"}
            aria-autocomplete="list"
            .value=${this.term}
            placeholder=${this.placeholder}
            class="min-w-48 flex-1 rounded-merchant border border-slate-300 bg-white px-3 py-2 text-sm
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            @input=${(e) => this.onInput(e)}
            @keydown=${(e) => this.onKeyDown(e)}
          />
          ${this.renderGroupFilter()}
        </div>

        <div class="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <span part="scope" class="text-slate-500 dark:text-slate-400">
            Searching ${SCOPE_LABEL[this.scope]}${this.searching ? " …" : ""}
            ${this.renderCount()}
          </span>
          <span class="flex items-center gap-2">
            ${this.scope !== "branch" && this.workingBranchId != null
              ? html`<button
                  part="narrow"
                  type="button"
                  class="text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
                  @click=${() => this.narrow()}
                >
                  Back to this branch
                </button>`
              : nothing}
            ${this.scope === "branch"
              ? html`<button
                  part="widen"
                  type="button"
                  class="font-medium text-sky-700 hover:underline dark:text-sky-300"
                  @click=${() => this.widen()}
                >
                  Search whole catalogue
                </button>`
              : nothing}
          </span>
        </div>

        ${this.summary && this.scope === "branch"
          ? html`<p part="range" class="mt-1 text-xs text-slate-400 dark:text-slate-500">
              ${this.summary.ranged.toLocaleString("en-GB")} of
              ${this.summary.catalogue.toLocaleString("en-GB")} lines ranged here ·
              ${this.summary.core.toLocaleString("en-GB")} core
            </p>`
          : nothing}

        ${this.error ? this.renderError(this.error, { onRetry: () => this.runSearch() }) : nothing}

        ${this.selectedRow && this.collapseOnSelect
          ? this.renderSelected()
          : hint
            ? html`<p part="hint" class="mt-2 text-xs text-slate-500 dark:text-slate-400">${hint}</p>`
            : this.results.length
              ? html`
                  ${this.selectedRow ? this.renderSelected() : nothing}
                  <ul
                    part="results"
                    role="listbox"
                    class="mt-2 overflow-hidden rounded-merchant border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  >
                    ${this.results.map((row, i) => this.renderRow(row, i))}
                  </ul>
                `
              : html`<p part="empty" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  ${this.renderEmptyResult()}
                </p>`}
      </section>
    `;
  }
}

customElements.define("merchant-find-product", MerchantFindProduct);
