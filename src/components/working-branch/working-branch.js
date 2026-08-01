// working-branch v0.1.0 — which branch is this member of staff operating from?
//
// John Smith signs in at the Warrington counter and the system sets him to Warrington,
// because that is his app_user.default_branch_id. A sales desk rep covering Liverpool and
// Manchester needs to switch between the branches they cover. That is this component.
//
// Distinct from <merchant-select-branch> (docs/plan.md §9):
//   working-branch  location — where the user physically is; app_user.default_branch_id;
//                   session context; compact, lives in a header or toolbar
//   select-branch   purpose  — which branch for this order/transfer; a considered choice;
//                   card grid with addresses
//
// A native <select> is used deliberately: keyboard, mobile and screen-reader behaviour all
// come free, and this control lives in furniture where compactness matters more than
// browsing. If the permitted list ever outgrows a select, this becomes a combobox — which
// is a change to this component only.

import { html, css, nothing } from "lit";
import { MerchantElement } from "../shared/merchant-element.js";
import { groupByRegion, codesConverter, branchLabel, missingCodes } from "../shared/branches.js";

export class MerchantWorkingBranch extends MerchantElement {
  static version = "0.1.0";

  static styles = [...MerchantElement.styles];

  static properties = {
    userId: { type: Number, attribute: "user-id" },
    allowedCodes: { attribute: "allowed-codes", converter: codesConverter },
    selectedId: { type: Number, attribute: "selected-id" },
    heading: { type: String },
    showUser: { type: Boolean, attribute: "show-user" },
    branches: { attribute: false, state: true },
    user: { attribute: false, state: true },
    defaultBranchId: { attribute: false, state: true },
  };

  static harnessSchema = [
    {
      name: "userId",
      type: "number",
      default: 1,
      description:
        "app_user id. Their default_branch_id is preselected — the sign-in behaviour. Try 1 (Manager, Chester).",
    },
    {
      name: "allowedCodes",
      type: "csv",
      default: null,
      description:
        "Branch codes this user may operate from, e.g. 01,03. Blank shows all — the dataset has no user→branch access table yet (docs/plan.md §7.7).",
    },
    {
      name: "selectedId",
      type: "number",
      default: null,
      description: "Override the selection. Blank falls back to the user's default branch.",
    },
    {
      name: "heading",
      type: "string",
      default: "Working from",
      description: "Label for the select. Blank hides it.",
    },
    {
      name: "showUser",
      type: "boolean",
      default: true,
      description: "Show who is signed in and their role beneath the control.",
    },
  ];

  constructor() {
    super();
    this.userId = null;
    this.allowedCodes = null;
    this.selectedId = null;
    this.heading = "Working from";
    this.showUser = true;
    this.branches = [];
    this.user = null;
    this.defaultBranchId = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchBranches();
  }

  updated(changed) {
    if (changed.has("userId") || changed.has("allowedCodes") || changed.has("api") || changed.has("apiBase")) {
      this.fetchBranches();
    }
  }

  async fetchBranches() {
    if (!this.userId) {
      this.branches = [];
      this.user = null;
      return;
    }

    const result = await this.load(() =>
      this.client.listBranchesForUser({
        userId: this.userId,
        codes: this.allowedCodes ?? undefined,
      }),
    );
    if (!result) return;

    this.branches = result.rows ?? [];
    this.user = result.user ?? null;
    this.defaultBranchId = result.defaultBranchId ?? null;

    // Sign-in behaviour: land on the user's default branch unless the host has already
    // chosen one. Only auto-select if that branch is actually in the permitted list —
    // a rep whose default branch was revoked should not be silently placed there.
    if (this.selectedId == null && this.defaultBranchId != null) {
      const fallback = this.branches.find((b) => b.id === this.defaultBranchId);
      if (fallback) this.select(fallback, { cause: "default" });
    }
  }

  get groups() {
    return groupByRegion(this.branches);
  }

  select(branch, { cause = "user" } = {}) {
    if (!branch) return;
    this.selectedId = branch.id;
    this.emit("merchant-working-branch-changed", {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      isDefault: branch.id === this.defaultBranchId,
      userId: this.userId,
      // "default" means the component preselected on load; "user" means someone chose.
      // A host persisting working context wants to tell those apart.
      cause,
    });
  }

  onChange(event) {
    const id = Number(event.target.value);
    this.select(this.branches.find((b) => b.id === id));
  }

  // NOT renderOptions() — LitElement owns that name as an instance field ({host: this}),
  // and an instance field silently shadows a prototype method. The symptom is
  // "this.renderOptions is not a function" at render time, with Lit leaving the previous
  // DOM in place, so the component looks stuck on an old state rather than broken.
  renderBranchOptions() {
    const groups = this.groups;
    const option = (b) => html`
      <option value=${b.id} ?selected=${b.id === this.selectedId}>
        ${branchLabel(b)}${b.id === this.defaultBranchId ? " (default)" : ""}
      </option>
    `;

    // Only group when there is more than one region to group by — optgroups round a
    // single region are noise.
    return groups.length > 1
      ? groups.map(
          (g) => html`<optgroup label=${g.name}>${g.rows.map(option)}</optgroup>`,
        )
      : this.branches.map(option);
  }

  render() {
    if (!this.userId) return this.renderEmpty("No user — set userId to a signed-in app_user.");
    if (this.loading && !this.branches.length) return this.renderSkeleton(1);
    if (this.error) return this.renderError(this.error, { onRetry: () => this.fetchBranches() });
    if (!this.branches.length) {
      return this.renderEmpty(
        this.allowedCodes?.length
          ? `No branches match the codes ${this.allowedCodes.join(", ")}.`
          : "This user has no permitted branches.",
      );
    }

    const missing = missingCodes(this.allowedCodes, this.branches);
    const selected = this.branches.find((b) => b.id === this.selectedId);
    const awayFromDefault =
      selected && this.defaultBranchId != null && selected.id !== this.defaultBranchId;

    return html`
      <section part="root" class="text-slate-900 dark:text-slate-100">
        <label class="block">
          ${this.heading
            ? html`<span
                part="heading"
                class="mb-1 block text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
                >${this.heading}</span
              >`
            : nothing}
          <select
            part="select"
            class="w-full rounded-merchant border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            @change=${(e) => this.onChange(e)}
          >
            ${this.selectedId == null
              ? html`<option value="" selected>Choose a branch…</option>`
              : nothing}
            ${this.renderBranchOptions()}
          </select>
        </label>

        ${awayFromDefault
          ? html`<p
              part="notice"
              class="mt-1.5 text-xs text-amber-800 dark:text-amber-300"
            >
              Not your default branch (${this.branches.find((b) => b.id === this.defaultBranchId)
                ?.name ?? "unknown"}).
            </p>`
          : nothing}
        ${missing.length
          ? html`<p part="notice" class="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
              Unknown branch ${missing.length === 1 ? "code" : "codes"}:
              <span class="font-mono">${missing.join(", ")}</span>
            </p>`
          : nothing}
        ${this.showUser && this.user
          ? html`<p part="user" class="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              ${this.user.given_name} ${this.user.surname}
              ${this.user.role ? html`· ${this.user.role}` : nothing}
              <span class="font-mono opacity-70">(${this.user.username})</span>
            </p>`
          : nothing}
      </section>
    `;
  }
}

customElements.define("merchant-working-branch", MerchantWorkingBranch);
