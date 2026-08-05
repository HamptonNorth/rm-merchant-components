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
import { AVAILABILITY, perLabel } from "../shared/availability.js";

const SCOPES = ["branch", "all"];

const SCOPE_LABEL = {
  branch: "this branch's range",
  all: "the whole catalogue",
};

export class MerchantFindProduct extends MerchantElement {
  static version = "0.2.1";

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
    pageSize: { type: Number, attribute: "page-size" },
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
    page: { state: true },
  };

  static harnessSchema = [
    {
      name: "workingBranchId",
      type: "number",
      default: 7,
      description:
        "The branch this counter is working from, from <merchant-working-branch>. This is a branch id, not a branch code — they differ, and code 13 is id 7. Which branch is the specialist is chosen at generation time, so use the \u201CSpecialist branch\u201D scenario rather than trusting this default after a regeneration.",
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
    {
      name: "pageSize",
      type: "number",
      default: 20,
      description:
        "Results per page. Browsing a group is what needs this — Top.Timber is 272 lines at one branch, and no counter scrolls that. The API caps a page at 500.",
    },
  ];

  #debounce = null;
  #sequence = 0;

  constructor() {
    super();
    this.workingBranchId = null;
    this.scope = "branch";
    this.groupPath = "";
    this.pageSize = 20;
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
    this.page = 1;
  }

  get totalPages() {
    return Math.max(1, Math.ceil(this.matchCount / Math.max(1, this.pageSize)));
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadFacets();
  }

  updated(changed) {
    if (changed.has("workingBranchId") || changed.has("api")) this.loadFacets();
    // Anything that changes what is being looked at invalidates the page number: staying on
    // page 7 after switching to a group with three pages shows an empty list and reads as a
    // bug. The group is included because picking one is now a search in its own right.
    if (
      changed.has("scope") ||
      changed.has("workingBranchId") ||
      changed.has("groupPath") ||
      changed.has("pageSize") ||
      changed.has("api")
    ) {
      // The selected card states availability, which is a per-branch fact. After a branch or
      // scope change it is not stale, it is wrong.
      if (changed.has("workingBranchId") || changed.has("scope") || changed.has("groupPath")) {
        this.selectedRow = null;
      }
      this.page = 1;
      if (this.term || this.groupPath) this.search({ immediate: true });
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
    // Typing is a new question, so it starts at the beginning of the answer, and abandons
    // the current pick. Clearing this here rather than in runSearch is the whole point:
    // runSearch returns early on an empty box, so emptying it used to leave the selected
    // card on screen with no results, no hint and nothing to search from.
    this.selectedRow = null;
    this.page = 1;
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
    // No term and no filter is the cold start, not a browse — the hint is more use than
    // page 1 of the whole catalogue. A group makes it a browse.
    if (!term && !this.groupPath) {
      this.results = [];
      this.route = "none";
      this.activeIndex = -1;
      this.matchCount = 0;
      this.truncated = false;
      this.page = 1;
      return;
    }

    const seq = ++this.#sequence;
    this.searching = true;
    const result = await this.load(() =>
      this.client.searchProducts({
        term,
        branchId: this.workingBranchId ?? undefined,
        scope: this.scope,
        groupPath: this.groupPath || undefined,
        limit: this.pageSize,
        offset: (this.page - 1) * this.pageSize,
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

    // A page beyond the end returns nothing, which looks like "no results" rather than
    // "you have gone too far". Happens when the row count shrinks under a filter change.
    if (!this.results.length && this.page > 1 && this.matchCount > 0) {
      this.goTo(this.totalPages);
    }
  }

  goTo(page) {
    const target = Math.min(Math.max(1, Math.round(page) || 1), this.totalPages);
    if (target === this.page) return;
    this.page = target;
    this.activeIndex = -1;
    this.search({ immediate: true });
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
      this.newSearch();
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

  // Back to the list this was picked from — for "wrong one of these", which is not the same
  // as "wrong search".
  reopen() {
    this.selectedRow = null;
  }

  // Start over. The box keeps the old term after a pick, so without this the only way to
  // search for something else is to select the text and overtype it.
  newSearch() {
    this.term = "";
    this.selectedRow = null;
    this.results = [];
    this.route = "none";
    this.matchCount = 0;
    this.truncated = false;
    this.page = 1;
    this.activeIndex = -1;
    // Focus follows the action: clearing the box is only ever a prelude to typing in it.
    this.updateComplete.then(() => this.shadowRoot?.querySelector("input[type=search]")?.focus());
  }

  onGroupChange(event) {
    this.groupPath = event.target.value;
  }

  onPageInput(event) {
    const n = Number(event.target.value);
    if (Number.isFinite(n)) this.goTo(n);
    // Snap the box back to whatever page actually loaded, so a typed 99 does not sit there
    // claiming to be the current page.
    event.target.value = String(this.page);
  }

  // Price, unit and the multi-unit marker are one non-breaking group. Spaced apart they read
  // as separate facts and the marker looks like a typo — "£18.50 each + Panel Products
  // Distribution" parses as a conjunction rather than a footnote.
  renderPrice(row) {
    if (row.price_pence === null || row.price_pence === undefined) return nothing;
    const per = perLabel(row.price_per);
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
          ${this.results.length > 1
            ? html`<button
                part="reopen"
                type="button"
                class="ml-1 font-medium text-sky-700 underline hover:no-underline dark:text-sky-300"
                @click=${() => this.reopen()}
              >
                Back to results
              </button>`
            : nothing}
          <button
            part="new-search"
            type="button"
            class="ml-2 font-medium text-sky-700 underline hover:no-underline dark:text-sky-300"
            @click=${() => this.newSearch()}
          >
            New search
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

    if (total <= shown) return html`· ${fmt(shown)} ${shown === 1 ? "match" : "matches"}`;
    // Which rows these are, not just how many exist. "21–40 of 272" tells you where you are
    // in the answer; "20 of 272" leaves you guessing whether you have seen the first twenty
    // or some arbitrary twenty.
    const from = (this.page - 1) * this.pageSize + 1;
    return html`· ${fmt(from)}–${fmt(from + shown - 1)} of ${fmt(total)}`;
  }

  // Paging is what makes browsing a group usable: Top.Timber is 272 lines at one branch.
  // First and Last are not padding — jumping to the end of an alphabetical list is how you
  // check you filtered the right group without dragging through every page.
  renderPager() {
    if (this.selectedRow && this.collapseOnSelect) return nothing;
    const pages = this.totalPages;
    if (pages <= 1 || !this.results.length) return nothing;

    const btn = (label, target, { disabled = false, title = "" } = {}) => html`
      <button
        part="page-${label.toLowerCase().replace(/[^a-z]/g, "") || "n"}"
        type="button"
        title=${title}
        ?disabled=${disabled}
        class="rounded border border-slate-300 px-2 py-1 font-medium
               disabled:cursor-not-allowed disabled:opacity-40
               enabled:hover:bg-slate-100 dark:border-slate-700 dark:enabled:hover:bg-slate-800"
        @click=${() => this.goTo(target)}
      >
        ${label}
      </button>
    `;
    const first = this.page === 1;
    const last = this.page === pages;

    return html`
      <nav
        part="pager"
        aria-label="Result pages"
        class="mt-2 flex flex-wrap items-center justify-center gap-1 text-xs text-slate-600 dark:text-slate-300"
      >
        ${btn("« First", 1, { disabled: first, title: "First page" })}
        ${btn("‹ Prev", this.page - 1, { disabled: first, title: "Previous page" })}
        <span class="mx-1 flex items-center gap-1">
          Page
          <input
            part="page-input"
            type="number"
            min="1"
            max=${pages}
            .value=${String(this.page)}
            aria-label="Page number"
            class="w-14 rounded border border-slate-300 px-1 py-1 text-center tabular-nums
                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            @change=${(e) => this.onPageInput(e)}
            @keydown=${(e) => {
              // Enter inside the pager must not reach the results list and select a row.
              if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); this.onPageInput(e); }
            }}
          />
          of ${pages.toLocaleString("en-GB")}
        </span>
        ${btn("Next ›", this.page + 1, { disabled: last, title: "Next page" })}
        ${btn("Last »", pages, { disabled: last, title: "Last page" })}
      </nav>
    `;
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
    const browsable = this.showGroupFilter && this.groups.length ? ", or pick a group to browse" : "";
    if (this.route === "too_short") {
      return `Keep typing — 3 characters for a name, 2 for a code${browsable}.`;
    }
    if (this.route === "none") return `Type a product code or name, or scan a barcode${browsable}.`;
    return null;
  }

  renderEmptyResult() {
    // Browsing a group that is empty here is a different message from a search that missed:
    // there is nothing to rephrase, only somewhere else to look.
    if (this.route === "browse" && this.scope === "branch") {
      return html`This branch ranges nothing in ${this.groupPath}.
        <button
          type="button"
          class="font-medium text-sky-700 underline hover:no-underline dark:text-sky-300"
          @click=${() => this.widen()}
        >
          Browse the whole catalogue
        </button>`;
    }
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
                  ${this.renderPager()}
                `
              : html`<p part="empty" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  ${this.renderEmptyResult()}
                </p>`}
      </section>
    `;
  }
}

customElements.define("merchant-find-product", MerchantFindProduct);
