// credit-status v0.1.0 — can this customer have the goods?
//
// Two tiers (docs/plan.md §9). The summary answers the question and paints on its own call;
// the invoice list shows the working and loads separately. A counter hand waiting on a
// hundred-row list to discover an account is on stop is waiting for the wrong thing.
//
// It states a verdict rather than presenting numbers to interpret. "£4,120 outstanding
// against a £2,500 limit" requires arithmetic at a counter with somebody waiting; "OVER
// LIMIT" does not.

import { html, css, nothing } from "lit";
import { MerchantElement } from "../shared/merchant-element.js";
import { fmtPence, fmtDate } from "../shared/format.js";

const VERDICT = {
  on_stop: {
    label: "ON STOP",
    tone: "bg-red-600 text-white",
    note: "Do not release goods. Refer to the account manager.",
  },
  over_limit: {
    label: "OVER LIMIT",
    tone: "bg-red-600 text-white",
    note: "Outstanding balance exceeds the credit limit.",
  },
  near_limit: {
    label: "NEAR LIMIT",
    tone: "bg-amber-500 text-white",
    note: "Little headroom left — check the order value before releasing.",
  },
  ok: { label: "OK", tone: "bg-emerald-600 text-white", note: null },
  cash: {
    label: "CASH ACCOUNT",
    tone: "bg-slate-600 text-white",
    note: "No credit facility — settle at the counter.",
  },
  no_limit_set: {
    label: "NO LIMIT SET",
    tone: "bg-amber-500 text-white",
    note: "Credit account with no limit on file.",
  },
};

// Oldest debt on the right, and the colour earns its place: 90+ days is the number that
// decides whether goods go out.
const BAND_TONE = {
  current: "bg-emerald-500",
  30: "bg-amber-400",
  60: "bg-orange-500",
  90: "bg-red-600",
};

export class MerchantCreditStatus extends MerchantElement {
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
    customerId: { type: Number, attribute: "customer-id" },
    asOf: { type: String, attribute: "as-of" },
    showInvoices: { type: Boolean, attribute: "show-invoices" },
    dense: { type: Boolean },
    pageSize: { type: Number, attribute: "page-size" },
    view: { type: String },
    band: { type: String },
    sort: { type: String },
    summary: { attribute: false, state: true },
    invoices: { attribute: false, state: true },
    invoiceTotal: { state: true },
    offset: { state: true },
    loadingInvoices: { state: true },
  };

  static harnessSchema = [
    {
      name: "customerId",
      type: "number",
      default: 1,
      description:
        "Customer to check. Try 86 (on stop), 34 (over limit), 2 (cash account with history) or 13528 (103 unpaid invoices).",
    },
    {
      name: "asOf",
      type: "string",
      default: "",
      description:
        "Ageing reference date (YYYY-MM-DD). Blank uses today. Pin it to keep buckets stable as the dataset ages.",
    },
    {
      name: "view",
      type: "select",
      options: ["unpaid", "recent"],
      default: "unpaid",
      description: "Unpaid only, or every recent invoice.",
    },
    {
      name: "showInvoices",
      type: "boolean",
      default: true,
      description: "Show the drill-down list. Off leaves just the verdict and ageing.",
    },
    { name: "dense", type: "boolean", default: false, description: "Tighter invoice rows." },
    { name: "pageSize", type: "number", default: 10, description: "Invoices per page." },
  ];

  constructor() {
    super();
    this.customerId = null;
    this.asOf = "";
    this.showInvoices = true;
    this.dense = false;
    this.pageSize = 10;
    this.view = "unpaid";
    this.band = "";
    this.sort = "date_desc";
    this.summary = null;
    this.invoices = [];
    this.invoiceTotal = 0;
    this.offset = 0;
    this.loadingInvoices = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.reload();
  }

  updated(changed) {
    if (changed.has("customerId") || changed.has("asOf") || changed.has("api")) {
      this.offset = 0;
      this.reload();
    } else if (changed.has("view") || changed.has("band") || changed.has("sort") || changed.has("pageSize")) {
      this.offset = 0;
      this.loadInvoices();
    }
  }

  async reload() {
    if (!this.customerId) {
      this.summary = null;
      this.invoices = [];
      return;
    }
    // Deliberately not awaited together: the verdict is what someone is waiting for.
    this.loadSummary();
    if (this.showInvoices) this.loadInvoices();
  }

  async loadSummary() {
    const result = await this.load(() =>
      this.client.getCreditSummary({ customerId: this.customerId, asOf: this.asOf || undefined }),
    );
    if (!result) return;
    this.summary = result;
    this.emit("merchant-credit-checked", {
      customerId: this.customerId,
      verdict: result.verdict,
      outstandingPence: result.outstandingPence,
      headroomPence: result.headroomPence,
      limitPence: result.limitPence,
      unpaidCount: result.unpaidCount,
      oldestUnpaidDays: result.oldestUnpaidDays,
    });
  }

  async loadInvoices() {
    if (!this.customerId || !this.showInvoices) return;
    this.loadingInvoices = true;
    try {
      const result = await this.client.listInvoices({
        customerId: this.customerId,
        view: this.view,
        band: this.band || undefined,
        sort: this.sort,
        limit: this.pageSize,
        offset: this.offset,
        asOf: this.asOf || undefined,
      });
      this.invoices = result.rows ?? [];
      this.invoiceTotal = result.matchCount ?? this.invoices.length;
    } catch (err) {
      this.error = err;
    } finally {
      this.loadingInvoices = false;
    }
  }

  // Clicking a bucket filters the list to it — the natural next question after seeing £22
  // sitting in 90+ is "which invoice is that".
  selectBand(bandId) {
    this.band = this.band === bandId ? "" : bandId;
    this.view = "unpaid";
  }

  page(delta) {
    const next = this.offset + delta * this.pageSize;
    if (next < 0 || next >= this.invoiceTotal) return;
    this.offset = next;
    this.loadInvoices();
  }

  selectInvoice(row) {
    this.emit("merchant-invoice-selected", {
      customerId: this.customerId,
      invoiceNumber: row.invoice_number,
      transactionDate: row.transaction_date,
      grossPence: row.gross_pence,
      unpaidPence: row.unpaid_pence,
      ageDays: row.age_days,
    });
  }

  renderVerdict() {
    const s = this.summary;
    const v = VERDICT[s.verdict] ?? VERDICT.ok;
    const isCash = s.verdict === "cash";

    return html`
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="flex flex-wrap items-baseline gap-2">
            <span class="font-mono text-xs text-slate-500 dark:text-slate-400"
              >${s.customer.account_code}</span
            >
            <span class="font-semibold text-slate-900 dark:text-slate-100">${s.customer.name}</span>
          </p>
          <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            ${s.customer.town} · ${s.customer.branch_name}
            ${s.customer.po_required ? html`· <span class="font-medium">PO required</span>` : nothing}
          </p>
        </div>
        <span
          part="verdict"
          class="shrink-0 rounded-merchant px-2.5 py-1 text-xs font-bold tracking-wide ${v.tone}"
          >${v.label}</span
        >
      </div>

      ${v.note
        ? html`<p
            part="verdict-note"
            class="mt-2 text-xs font-medium ${s.verdict === "on_stop" || s.verdict === "over_limit"
              ? "text-red-700 dark:text-red-400"
              : "text-amber-700 dark:text-amber-300"}"
          >
            ${v.note}
          </p>`
        : nothing}

      ${isCash
        ? nothing
        : html`
            <dl class="mt-3 grid grid-cols-3 gap-3 text-sm">
              ${this.renderFigure("Credit limit", s.limitPence)}
              ${this.renderFigure("Outstanding", s.outstandingPence)}
              ${this.renderFigure("Headroom", s.headroomPence, s.headroomPence < 0)}
            </dl>
          `}
    `;
  }

  renderFigure(label, pence, danger = false) {
    return html`
      <div>
        <dt class="text-xs text-slate-500 dark:text-slate-400">${label}</dt>
        <dd
          class="font-mono tabular-nums ${danger
            ? "font-semibold text-red-700 dark:text-red-400"
            : "text-slate-900 dark:text-slate-100"}"
        >
          ${pence === null || pence === undefined ? "—" : fmtPence(pence)}
        </dd>
      </div>
    `;
  }

  renderAgeing() {
    const s = this.summary;
    if (!s.outstandingPence) {
      return html`<p part="ageing" class="mt-3 text-sm text-slate-500 dark:text-slate-400">
        Nothing outstanding.
      </p>`;
    }

    return html`
      <div part="ageing" class="mt-3">
        <div class="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          ${s.bands
            .filter((b) => b.pence > 0)
            .map(
              (b) => html`<span
                class="${BAND_TONE[b.id]}"
                style="width:${((b.pence / s.outstandingPence) * 100).toFixed(2)}%"
                title="${b.label}: ${fmtPence(b.pence)}"
              ></span>`,
            )}
        </div>
        <div class="mt-1.5 grid grid-cols-4 gap-2">
          ${s.bands.map(
            (b) => html`
              <button
                part=${this.band === b.id ? "band band-active" : "band"}
                type="button"
                ?disabled=${!b.pence}
                aria-pressed=${this.band === b.id ? "true" : "false"}
                class="rounded-merchant border px-1.5 py-1 text-left text-xs transition
                       disabled:cursor-default disabled:opacity-45
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                       ${this.band === b.id
                  ? "border-accent bg-accent-soft dark:bg-slate-800"
                  : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"}"
                @click=${() => this.selectBand(b.id)}
              >
                <span class="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                  <span class="inline-block h-1.5 w-1.5 rounded-full ${BAND_TONE[b.id]}"></span>
                  ${b.label}
                </span>
                <span class="mt-0.5 block font-mono tabular-nums text-slate-900 dark:text-slate-100"
                  >${fmtPence(b.pence, { whole: true })}</span
                >
              </button>
            `,
          )}
        </div>
        ${s.oldestUnpaidDate
          ? html`<p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
              ${s.unpaidCount} unpaid ${s.unpaidCount === 1 ? "invoice" : "invoices"} · oldest
              ${fmtDate(s.oldestUnpaidDate)}
              <span class=${s.oldestUnpaidDays >= 90 ? "font-medium text-red-700 dark:text-red-400" : ""}
                >(${s.oldestUnpaidDays} days)</span
              >
            </p>`
          : nothing}
      </div>
    `;
  }

  renderInvoiceRow(row) {
    return html`
      <tr
        part="invoice"
        class="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
        @click=${() => this.selectInvoice(row)}
      >
        <td class="${this.dense ? "py-1" : "py-1.5"} pr-2 font-mono text-xs">${row.invoice_number}</td>
        <td class="pr-2 text-xs whitespace-nowrap">${fmtDate(row.transaction_date)}</td>
        <td class="pr-2 text-right font-mono text-xs tabular-nums">${row.age_days}d</td>
        <td class="pr-2 font-mono text-xs text-slate-500 dark:text-slate-400">${row.purchase_order}</td>
        <td class="pr-2 text-right font-mono text-xs tabular-nums">${fmtPence(row.gross_pence)}</td>
        <td
          class="text-right font-mono text-xs tabular-nums ${row.unpaid_pence
            ? "font-semibold text-slate-900 dark:text-slate-100"
            : "text-slate-400 dark:text-slate-600"}"
        >
          ${row.unpaid_pence ? fmtPence(row.unpaid_pence) : "paid"}
        </td>
      </tr>
    `;
  }

  renderInvoices() {
    if (!this.showInvoices) return nothing;
    const from = this.offset + 1;
    const to = Math.min(this.offset + this.invoices.length, this.invoiceTotal);
    const bandLabel = this.summary.bands.find((b) => b.id === this.band)?.label;

    return html`
      <div part="invoices" class="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1 text-xs">
            ${["unpaid", "recent"].map(
              (v) => html`<button
                type="button"
                class="rounded px-2 py-0.5 font-medium ${this.view === v
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}"
                @click=${() => (this.view = v)}
              >
                ${v === "unpaid" ? "Unpaid" : "Recent"}
              </button>`,
            )}
            ${bandLabel
              ? html`<button
                  type="button"
                  class="ml-1 rounded bg-accent-soft px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  @click=${() => (this.band = "")}
                >
                  ${bandLabel} ✕
                </button>`
              : nothing}
          </div>
          <span class="text-xs text-slate-500 dark:text-slate-400">
            ${this.invoiceTotal ? `${from}–${to} of ${this.invoiceTotal.toLocaleString("en-GB")}` : "none"}
          </span>
        </div>

        ${this.loadingInvoices && !this.invoices.length
          ? this.renderSkeleton(3)
          : this.invoices.length
            ? html`
                <table class="mt-2 w-full text-left">
                  <thead>
                    <tr class="text-xs text-slate-500 dark:text-slate-400">
                      <th class="pr-2 font-medium">Invoice</th>
                      <th class="pr-2 font-medium">
                        <button
                          type="button"
                          class="hover:underline"
                          @click=${() => (this.sort = this.sort === "date_desc" ? "date_asc" : "date_desc")}
                        >
                          Date${this.sort.startsWith("date") ? (this.sort === "date_desc" ? " ↓" : " ↑") : ""}
                        </button>
                      </th>
                      <th class="pr-2 text-right font-medium">Age</th>
                      <th class="pr-2 font-medium">PO</th>
                      <th class="pr-2 text-right font-medium">
                        <button
                          type="button"
                          class="hover:underline"
                          @click=${() => (this.sort = this.sort === "value_desc" ? "value_asc" : "value_desc")}
                        >
                          Gross${this.sort.startsWith("value") ? (this.sort === "value_desc" ? " ↓" : " ↑") : ""}
                        </button>
                      </th>
                      <th class="text-right font-medium">Unpaid</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.invoices.map((row) => this.renderInvoiceRow(row))}
                  </tbody>
                </table>
                ${this.invoiceTotal > this.pageSize
                  ? html`<div class="mt-2 flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        ?disabled=${this.offset === 0}
                        class="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40 dark:border-slate-700"
                        @click=${() => this.page(-1)}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        ?disabled=${this.offset + this.pageSize >= this.invoiceTotal}
                        class="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40 dark:border-slate-700"
                        @click=${() => this.page(1)}
                      >
                        Next
                      </button>
                    </div>`
                  : nothing}
              `
            : html`<p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                ${this.band ? "Nothing in this age band." : "No invoices."}
              </p>`}
      </div>
    `;
  }

  render() {
    if (!this.customerId) return this.renderEmpty("No customer — set customerId.");
    if (this.error) return this.renderError(this.error, { onRetry: () => this.reload() });
    if (!this.summary) return this.renderSkeleton(4);

    return html`
      <section
        part="root"
        class="rounded-merchant border border-slate-200 bg-white p-4 text-slate-900
               dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        ${this.renderVerdict()} ${this.renderAgeing()} ${this.renderInvoices()}
        <p class="mt-3 text-xs text-slate-400 dark:text-slate-500">
          Ageing as at ${fmtDate(this.summary.asOf)}.
        </p>
      </section>
    `;
  }
}

customElements.define("merchant-credit-status", MerchantCreditStatus);
