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
//
// The list is the user's actual coverage (app_user_branch), and the notice under it reports
// whether they hold any permissions at the branch they have selected — not merely whether
// it differs from their default. See accessFor().

import { html, css, nothing } from "lit";
import { MerchantElement } from "../shared/merchant-element.js";
import { groupByRegion, codesConverter, branchLabel, missingCodes } from "../shared/branches.js";

export class MerchantWorkingBranch extends MerchantElement {
  static version = "0.2.0";

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
        "Narrow the list further, e.g. 01,03. The list already comes from this user's coverage, so this can only subtract from it.",
    },
    {
      name: "selectedId",
      type: "number",
      default: null,
      description:
        "Override the selection. Blank falls back to the user's default branch. Set it to a branch they do not cover to see the no-permissions state.",
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

  // How the selected branch stands for this user. Three states, in the order a person
  // cares about them:
  //
  //   default    their own branch — the ordinary case
  //   permitted  they hold permissions here, but it is not where they are based
  //   denied     they hold nothing here and cannot work from it
  //
  // The test is the permission count, not whether the branch differs from their default.
  // Being away from your default branch is normal for anyone covering more than one — a
  // rep at Warrington instead of Chester is working, not doing something irregular — so
  // warning about it trains people to ignore the warning.
  accessFor(branch) {
    if (!branch) return "denied";
    if (!branch.permission_count) return "denied";
    return branch.id === this.defaultBranchId ? "default" : "permitted";
  }

  get selectedBranch() {
    return this.branches.find((b) => b.id === this.selectedId) ?? null;
  }

  get access() {
    return this.selectedId == null ? null : this.accessFor(this.selectedBranch);
  }

  select(branch, { cause = "user" } = {}) {
    if (!branch) return;
    this.selectedId = branch.id;
    this.emit("merchant-working-branch-changed", {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      isDefault: branch.id === this.defaultBranchId,
      access: this.accessFor(branch),
      permissionCount: branch.permission_count ?? 0,
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
    const options =
      groups.length > 1
        ? groups.map((g) => html`<optgroup label=${g.name}>${g.rows.map(option)}</optgroup>`)
        : this.branches.map(option);

    // A host can set selectedId to a branch this user has no access to — a working branch
    // restored from a stale session, or permissions revoked since. The select would
    // otherwise silently show the first option while the notice says access is denied,
    // which is worse than either message alone.
    if (this.selectedId != null && !this.selectedBranch) {
      return [
        html`<option value=${this.selectedId} selected disabled>
          Branch not available to you
        </option>`,
        ...options,
      ];
    }
    return options;
  }

  renderAccessNotice() {
    const state = this.access;
    if (!state) return nothing;

    const branch = this.selectedBranch;
    const count = branch?.permission_count ?? 0;
    const permissions = `${count} permission${count === 1 ? "" : "s"}`;
    const defaultName =
      this.branches.find((b) => b.id === this.defaultBranchId)?.name ??
      this.user?.default_branch_name ??
      "unknown";

    const NOTICE = {
      default: {
        tone: "text-slate-500 dark:text-slate-400",
        text: `Your default branch — ${permissions} here.`,
      },
      permitted: {
        tone: "text-sky-700 dark:text-sky-300",
        text: `Valid working branch, not your default (${defaultName}) — ${permissions} here.`,
      },
      denied: {
        tone: "font-medium text-red-700 dark:text-red-400",
        text: "No permissions at this branch — you cannot work from here.",
      },
    }[state];

    return html`<p part="notice access-${state}" class="mt-1.5 text-xs ${NOTICE.tone}">
      ${NOTICE.text}
    </p>`;
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

        ${this.renderAccessNotice()}
        ${missing.length
          ? html`<p part="notice" class="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
              Not among your branches:
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
