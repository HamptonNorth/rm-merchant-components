// select-branch v0.2.0 — pick a branch for a purpose, as a card grid.
//
// This is the "which branch for this piece of work" picker: order-taking branch, issuing
// branch, transfer destination. It shows address and contact detail because the choice is
// considered rather than habitual.
//
// It is NOT the picker for "where am I working today" — that is <merchant-working-branch>,
// which is a compact dropdown driven by app_user.default_branch_id. The two were split
// deliberately (docs/plan.md §9): different question, different data source, different
// default, different a11y model, independent version numbers.
//
// v0.3.0 (Phase 1) adds `customerId` to pin the customer's OWNING branch —
// customer.home_branch_id, an ownership relation, not a location.

import { html, css, nothing } from "lit";
import { MerchantElement } from "../shared/merchant-element.js";
import { addressLines } from "../shared/format.js";
import { groupByRegion, codesConverter, missingCodes } from "../shared/branches.js";

export class MerchantSelectBranch extends MerchantElement {
  static version = "0.2.0";

  static styles = [
    ...MerchantElement.styles,
    css`
      :host {
        container-type: inline-size;
      }
    `,
  ];

  static properties = {
    regionId: { type: Number, attribute: "region-id" },
    allowedCodes: { attribute: "allowed-codes", converter: codesConverter },
    selectedId: { type: Number, attribute: "selected-id" },
    heading: { type: String },
    dense: { type: Boolean },
    showContact: { type: Boolean, attribute: "show-contact" },
    branches: { attribute: false, state: true },
  };

  static harnessSchema = [
    {
      name: "allowedCodes",
      type: "csv",
      default: null,
      description:
        "Branch codes to restrict the list to, e.g. 01,02,31. Blank shows every branch. Display filter only — real permissions come from the role matrix, server-side.",
    },
    {
      name: "regionId",
      type: "number",
      default: null,
      description: "Show only branches in this region id. Blank shows all 8 regions.",
    },
    {
      name: "selectedId",
      type: "number",
      default: null,
      description: "Branch id to mark as currently selected.",
    },
    {
      name: "heading",
      type: "string",
      default: "Select a branch",
      description: "Visible heading. Blank hides it.",
    },
    { name: "dense", type: "boolean", default: false, description: "Tighter rows, no addresses." },
    {
      name: "showContact",
      type: "boolean",
      default: true,
      description: "Show telephone on each branch. Ignored when dense.",
    },
  ];

  constructor() {
    super();
    this.regionId = null;
    this.allowedCodes = null;
    this.selectedId = null;
    this.heading = "Select a branch";
    this.dense = false;
    this.showContact = true;
    this.branches = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchBranches();
  }

  updated(changed) {
    if (changed.has("regionId") || changed.has("allowedCodes") || changed.has("api") || changed.has("apiBase")) {
      this.fetchBranches();
    }
  }

  async fetchBranches() {
    const result = await this.load(() =>
      this.client.listBranches({
        regionId: this.regionId ?? undefined,
        codes: this.allowedCodes ?? undefined,
      }),
    );
    this.branches = result?.rows ?? [];
  }

  get groups() {
    return groupByRegion(this.branches);
  }

  select(branch) {
    this.selectedId = branch.id;
    this.emit("merchant-branch-selected", {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      // v0.3.0 sets this from customer.home_branch_id — the branch that OWNS the
      // customer (prices, credit limit), not anyone's physical location.
      isCustomerHome: false,
    });
  }

  renderBranch(branch) {
    const selected = branch.id === this.selectedId;
    const lines = addressLines(branch);

    return html`
      <li>
        <button
          part=${selected ? "branch branch-selected" : "branch"}
          type="button"
          aria-pressed=${selected ? "true" : "false"}
          class="w-full rounded-merchant border p-3 text-left transition
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                 ${selected
            ? "border-accent bg-accent-soft dark:bg-slate-800"
            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"}"
          @click=${() => this.select(branch)}
        >
          <span class="flex items-baseline gap-2">
            <span
              class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >${branch.code}</span
            >
            <span class="font-medium text-slate-900 dark:text-slate-100">${branch.name}</span>
            ${selected
              ? html`<span class="ml-auto text-xs font-medium text-accent">Selected</span>`
              : nothing}
          </span>

          ${this.dense
            ? nothing
            : html`
                <span class="mt-1 block text-sm text-slate-600 dark:text-slate-400">
                  ${lines.join(", ")}${lines.length && branch.postcode ? ", " : ""}
                  <span class="font-mono">${branch.postcode}</span>
                </span>
              `}
          ${this.showContact && !this.dense
            ? html`
                <span class="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  ${branch.telephone}
                </span>
              `
            : nothing}
        </button>
      </li>
    `;
  }

  render() {
    if (this.loading && !this.branches.length) return this.renderSkeleton(4);
    if (this.error) return this.renderError(this.error, { onRetry: () => this.fetchBranches() });

    if (!this.branches.length) {
      if (this.allowedCodes?.length) {
        return this.renderEmpty(
          `No branches match the codes ${this.allowedCodes.join(", ")}.`,
        );
      }
      return this.renderEmpty(
        this.regionId ? `No branches in region ${this.regionId}.` : "No branches found.",
      );
    }

    const missing = missingCodes(this.allowedCodes, this.branches);

    return html`
      <section part="root" class="text-slate-900 dark:text-slate-100">
        ${this.heading
          ? html`<h2 part="heading" class="mb-3 text-base font-semibold">${this.heading}</h2>`
          : nothing}
        ${missing.length
          ? html`<p
              part="notice"
              class="mb-3 rounded-merchant border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
            >
              Unknown branch ${missing.length === 1 ? "code" : "codes"}:
              <span class="font-mono">${missing.join(", ")}</span>
            </p>`
          : nothing}

        <div class="space-y-5">
          ${this.groups.map(
            (group) => html`
              <div part="group">
                <h3
                  class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
                >
                  ${group.name}
                  <span class="ml-1 font-normal normal-case opacity-60"
                    >${group.rows.length} ${group.rows.length === 1 ? "branch" : "branches"}</span
                  >
                </h3>
                <ul class="grid grid-cols-1 gap-2 @md:grid-cols-2 @2xl:grid-cols-3">
                  ${group.rows.map((b) => this.renderBranch(b))}
                </ul>
              </div>
            `,
          )}
        </div>
      </section>
    `;
  }
}

customElements.define("merchant-select-branch", MerchantSelectBranch);
