// find-customer v0.1.0 — one text box at the trade counter.
//
// The same box has to sell a 50p bolt for cash and 20 pallets of bricks on a credit account,
// so it routes on what was typed rather than making anyone choose a search mode first
// (docs/plan.md §9):
//
//   1–9          that branch's quick code — one keystroke to the everyday cash account
//   DK/…         account code prefix
//   SK4, CH1 4   postcode, and the name search as well
//   4+ chars     name
//
// Routing happens server-side, because the account-code shape is a property of the dataset
// (datagenerator2 emits four formats) rather than of the UI. The component posts the raw term
// and is told which route answered.
//
// Scoped to the working branch, because that is the business rule and it keeps the query
// cheap. National accounts are always included regardless of branch. Widening goes to the
// curated neighbour list first and the whole network second — a Chester counter reaching
// Bangor is a real case; reaching Cornwall is almost never one.

import { html, css, nothing } from "lit";
import { MerchantElement } from "../shared/merchant-element.js";

const SCOPES = ["branch", "neighbours", "all"];

const SCOPE_LABEL = {
  branch: "this branch",
  neighbours: "nearby branches",
  all: "all branches",
};

export class MerchantFindCustomer extends MerchantElement {
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
    limit: { type: Number },
    heading: { type: String },
    placeholder: { type: String },
    term: { state: true },
    results: { attribute: false, state: true },
    route: { state: true },
    activeIndex: { state: true },
    searching: { state: true },
  };

  static harnessSchema = [
    {
      name: "workingBranchId",
      type: "number",
      default: 3,
      description:
        "The branch this counter is working from, from <merchant-working-branch>. Try 3 (Stockport, 3,635 customers) or 27 (Newtown, 91 — where widening earns its keep).",
    },
    {
      name: "scope",
      type: "select",
      options: SCOPES,
      default: "branch",
      description: "Search scope. The widen control steps through these; national accounts are in scope at every level.",
    },
    {
      name: "heading",
      type: "string",
      default: "Find customer",
      description: "Visible heading. Blank hides it.",
    },
    {
      name: "placeholder",
      type: "string",
      default: "Name, postcode, account code, or 1–9",
      description: "Input placeholder.",
    },
    { name: "limit", type: "number", default: 25, description: "Maximum rows returned." },
  ];

  #debounce = null;
  #sequence = 0;

  constructor() {
    super();
    this.workingBranchId = null;
    this.scope = "branch";
    this.limit = 25;
    this.heading = "Find customer";
    this.placeholder = "Name, postcode, account code, or 1–9";
    this.term = "";
    this.results = [];
    this.route = "none";
    this.activeIndex = -1;
    this.searching = false;
  }

  updated(changed) {
    if (changed.has("scope") || changed.has("workingBranchId") || changed.has("api")) {
      if (this.term) this.search({ immediate: true });
    }
  }

  onInput(event) {
    this.term = event.target.value;
    this.search();
  }

  search({ immediate = false } = {}) {
    clearTimeout(this.#debounce);
    // Counter staff type fast; a request per keystroke would mostly be wasted work and the
    // responses can land out of order.
    this.#debounce = setTimeout(() => this.runSearch(), immediate ? 0 : 180);
  }

  async runSearch() {
    const term = this.term.trim();
    if (!term) {
      this.results = [];
      this.route = "none";
      this.activeIndex = -1;
      return;
    }

    const seq = ++this.#sequence;
    this.searching = true;
    const result = await this.load(() =>
      this.client.searchCustomers({
        term,
        branchId: this.workingBranchId ?? undefined,
        scope: this.scope,
        limit: this.limit,
      }),
    );
    // A slower earlier request must not overwrite a faster later one.
    if (seq !== this.#sequence) return;

    this.searching = false;
    this.results = result?.rows ?? [];
    this.route = result?.route ?? "none";
    // A quick code resolves to exactly one account, so pre-arm it for Enter.
    this.activeIndex = this.route === "quick_code" && this.results.length ? 0 : -1;
  }

  onKeyDown(event) {
    if (!this.results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.activeIndex = Math.min(this.activeIndex + 1, this.results.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.select(this.results[this.activeIndex >= 0 ? this.activeIndex : 0]);
    } else if (event.key === "Escape") {
      this.term = "";
      this.results = [];
      this.route = "none";
    }
  }

  select(row) {
    if (!row) return;
    this.emit("merchant-customer-selected", {
      id: row.id,
      accountCode: row.account_code,
      name: row.name,
      accountType: row.account_type,
      creditStatus: row.credit_status,
      isNationalAccount: Boolean(row.is_national_account),
      isCounterAccount: Boolean(row.is_counter_account),
      homeBranchId: row.home_branch_id,
      // The order flow behaves differently after a quick code — that is a counter cash sale,
      // already decided — than after a name search.
      matchedOn: row.matched_on,
    });
  }

  widen() {
    const next = SCOPES[Math.min(SCOPES.indexOf(this.scope) + 1, SCOPES.length - 1)];
    if (next === this.scope) return;
    this.scope = next;
    this.emit("merchant-customer-search-widened", { scope: next, term: this.term });
  }

  narrow() {
    this.scope = "branch";
    this.emit("merchant-customer-search-widened", { scope: "branch", term: this.term });
  }

  renderBadges(row) {
    const badge = (text, classes) =>
      html`<span class="rounded px-1.5 py-0.5 text-xs font-medium ${classes}">${text}</span>`;

    return html`
      ${row.credit_status === "on_stop"
        ? badge("ON STOP", "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200")
        : nothing}
      ${row.is_counter_account
        ? badge("Counter", "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100")
        : badge(
            row.account_type === "cash" ? "Cash" : "Credit",
            row.account_type === "cash"
              ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
          )}
      ${row.is_national_account
        ? badge("National", "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200")
        : nothing}
    `;
  }

  renderRow(row, index) {
    const active = index === this.activeIndex;
    // Anything not owned by the working branch is called out. A Chester counter serving a
    // customer on Bangor's books needs to see that before taking the order, because the
    // owning branch holds the pricing and credit relationship (docs/plan.md §0).
    const elsewhere = this.workingBranchId != null && row.home_branch_id !== this.workingBranchId;

    return html`
      <li>
        <button
          part=${active ? "result result-active" : "result"}
          type="button"
          role="option"
          aria-selected=${active ? "true" : "false"}
          class="w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0
                 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent
                 dark:border-slate-800
                 ${active
            ? "bg-accent-soft dark:bg-slate-800"
            : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}"
          @click=${() => this.select(row)}
          @mousemove=${() => (this.activeIndex = index)}
        >
          <span class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span class="font-mono text-xs text-slate-500 dark:text-slate-400">${row.account_code}</span>
            <span class="font-medium text-slate-900 dark:text-slate-100">${row.name}</span>
            <span class="ml-auto flex shrink-0 items-center gap-1">${this.renderBadges(row)}</span>
          </span>
          <span class="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span>${row.town}</span>
            <span class="font-mono">${row.postcode}</span>
            ${elsewhere
              ? html`<span class="font-medium text-amber-700 dark:text-amber-300"
                  >${row.branch_name}</span
                >`
              : nothing}
          </span>
        </button>
      </li>
    `;
  }

  renderHint() {
    if (this.route === "too_short") {
      return "Keep typing — 4 characters for a name, 3 for a postcode.";
    }
    if (this.route === "none") {
      return "Type a name, postcode or account code, or press 1–9 for a quick code.";
    }
    return null;
  }

  render() {
    if (this.scope !== "all" && this.workingBranchId == null) {
      return this.renderEmpty("No working branch — set workingBranchId, or use scope=all.");
    }

    const hint = this.renderHint();
    const canWiden = this.scope !== "all";

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

        <input
          part="input"
          type="search"
          role="combobox"
          aria-expanded=${this.results.length ? "true" : "false"}
          aria-autocomplete="list"
          .value=${this.term}
          placeholder=${this.placeholder}
          class="w-full rounded-merchant border border-slate-300 bg-white px-3 py-2 text-sm
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          @input=${(e) => this.onInput(e)}
          @keydown=${(e) => this.onKeyDown(e)}
        />

        <div class="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <span part="scope" class="text-slate-500 dark:text-slate-400">
            Searching ${SCOPE_LABEL[this.scope]}${this.searching ? " …" : ""}
            ${this.route !== "none" && this.route !== "too_short" && this.results.length
              ? html`· ${this.results.length}
                  ${this.results.length === 1 ? "match" : "matches"}`
              : nothing}
          </span>
          <span class="flex items-center gap-2">
            ${this.scope !== "branch"
              ? html`<button
                  part="narrow"
                  type="button"
                  class="text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
                  @click=${() => this.narrow()}
                >
                  Back to this branch
                </button>`
              : nothing}
            ${canWiden
              ? html`<button
                  part="widen"
                  type="button"
                  class="font-medium text-sky-700 hover:underline dark:text-sky-300"
                  @click=${() => this.widen()}
                >
                  ${this.scope === "branch" ? "Widen to nearby branches" : "Widen to all branches"}
                </button>`
              : nothing}
          </span>
        </div>

        ${this.error ? this.renderError(this.error, { onRetry: () => this.runSearch() }) : nothing}

        ${hint
          ? html`<p part="hint" class="mt-2 text-xs text-slate-500 dark:text-slate-400">${hint}</p>`
          : this.results.length
            ? html`<ul
                part="results"
                role="listbox"
                class="mt-2 overflow-hidden rounded-merchant border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                ${this.results.map((row, i) => this.renderRow(row, i))}
              </ul>`
            : html`<p part="empty" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                No customer found in ${SCOPE_LABEL[this.scope]}.${canWiden
                  ? " Try widening the search."
                  : ""}
              </p>`}
      </section>
    `;
  }
}

customElements.define("merchant-find-customer", MerchantFindCustomer);
