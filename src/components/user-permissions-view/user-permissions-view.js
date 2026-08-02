// user-permissions-view v0.1.0 — what am I allowed to do, and where?
//
// The eventual entry point is the account button: a member of staff clicks their own name
// and reads this. So it is written for the person the permissions belong to, not for an
// administrator auditing them — plain wording, no permission codes, no ids.
//
// The hard part is volume. A counter assistant holds 3 grants; a head office user holds 430
// across 29 branches. Both must read well, which is why rows collapse by permission AND
// limit (a rep with £600 at home and £300 away sees two lines, because those are two facts)
// and branches are described the way people describe them — "All 4 North West branches",
// "All branches except Head Office". That logic is in shared/permissions.js and is tested
// separately; this file is layout.
//
// A category with nothing held is not rendered at all. Showing "Purchasing — none" to a
// counter assistant is noise, and greying out what they cannot do invites the question
// "how do I get that?" which this card cannot answer.

import { html, nothing } from "lit";
import { MerchantElement } from "../shared/merchant-element.js";
import { fmtPence } from "../shared/format.js";
import { groupGrants, isCollapsible } from "../shared/permissions.js";

export class MerchantUserPermissionsView extends MerchantElement {
  static version = "0.1.0";

  static styles = [...MerchantElement.styles];

  static properties = {
    userId: { type: Number, attribute: "user-id" },
    dense: { type: Boolean },
    heading: { type: String },
    showDescriptions: { type: Boolean, attribute: "show-descriptions" },
    user: { attribute: false, state: true },
    coverage: { attribute: false, state: true },
    grants: { attribute: false, state: true },
    catalogue: { attribute: false, state: true },
  };

  static harnessSchema = [
    {
      name: "userId",
      type: "number",
      default: 1,
      description:
        "app_user id — whoever is signed in. Try 1 (Manager, Chester) or 184 (Head office, 430 grants across 29 branches).",
    },
    {
      name: "dense",
      type: "boolean",
      default: true,
      description:
        "Collapse branches to ranges where the permission and limit are the same. Off lists every branch. Hidden when the user covers one branch, since there is nothing to collapse.",
    },
    {
      name: "heading",
      type: "string",
      default: "Your permissions",
      description: "Card heading. Blank hides it.",
    },
    {
      name: "showDescriptions",
      type: "boolean",
      default: true,
      description: "Show the one-line explanation under each permission name.",
    },
  ];

  constructor() {
    super();
    this.userId = null;
    this.dense = true;
    this.heading = "Your permissions";
    this.showDescriptions = true;
    this.user = null;
    this.coverage = [];
    this.grants = [];
    this.catalogue = [];
  }

  // connectedCallback and the first updated() both fire with userId set, so without this the
  // card would fetch twice on load and emit its loaded event twice — which a host counting
  // sign-ins would believe.
  #fetchedFor = null;

  connectedCallback() {
    super.connectedCallback();
    this.fetchPermissions();
  }

  updated(changed) {
    // A new API implementation or base URL means the same user must be fetched again.
    if (changed.has("api") || changed.has("apiBase")) this.fetchPermissions({ force: true });
    else if (changed.has("userId")) this.fetchPermissions();
  }

  async fetchPermissions({ force = false } = {}) {
    if (!this.userId) {
      this.#fetchedFor = null;
      this.user = null;
      this.coverage = [];
      this.grants = [];
      return;
    }
    if (!force && this.#fetchedFor === this.userId) return;
    this.#fetchedFor = this.userId;

    const result = await this.load(() => this.client.getUserPermissions({ userId: this.userId }));
    if (!result) {
      this.#fetchedFor = null; // a failure must not block the next attempt
      return;
    }

    this.user = result.user ?? null;
    this.coverage = result.coverage ?? [];
    this.grants = result.grants ?? [];
    this.catalogue = result.catalogue ?? [];

    this.emit("merchant-user-permissions-loaded", {
      userId: this.userId,
      branchCount: this.coverage.length,
      permissionCount: new Set(this.grants.map((g) => g.permission_id)).size,
      grantCount: this.grants.length,
    });
  }

  get categories() {
    return groupGrants({ grants: this.grants, coverage: this.coverage, dense: this.dense });
  }

  toggleDense() {
    this.dense = !this.dense;
    this.emit("merchant-user-permissions-density-changed", {
      userId: this.userId,
      dense: this.dense,
    });
  }

  // A threshold, not a ceiling: above it the action routes for approval, it is never
  // refused (datagenerator2 docs/requirements-permissions.md). Limits are round £50 figures,
  // so whole pounds always reads correctly.
  renderLimit(permission, variant) {
    if (!permission.isLimited) return nothing;
    const label = variant.limit == null ? "No approval needed" : fmtPence(variant.limit, { whole: true });
    return html`
      <span
        part="limit"
        class="shrink-0 rounded-merchant bg-slate-100 px-1.5 py-0.5 font-mono text-xs
               text-slate-700 tabular-nums dark:bg-slate-800 dark:text-slate-300"
        >${label}</span
      >
    `;
  }

  renderPermission(permission) {
    // Someone at one branch does not need "Chester" repeated down every row — it is in the
    // header and it cannot be anywhere else. Drop the whole list when that leaves nothing to
    // say, so an unlimited permission at a single branch is just its name.
    const showWhere = this.coverage.length > 1;
    const scopes = showWhere || permission.isLimited ? permission.variants : [];

    return html`
      <li part="permission" class="py-2">
        <p class="text-sm font-medium text-slate-900 dark:text-slate-100">${permission.name}</p>
        ${this.showDescriptions && permission.description
          ? html`<p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              ${permission.description}
            </p>`
          : nothing}
        ${scopes.length
          ? html`<ul class="mt-1 space-y-0.5">
              ${scopes.map(
                (v) => html`
                  <li part="scope" class="flex items-baseline gap-2 text-xs">
                    ${this.renderLimit(permission, v)}
                    ${showWhere
                      ? html`<span class="text-slate-600 dark:text-slate-400">${v.where}</span>`
                      : nothing}
                  </li>
                `,
              )}
            </ul>`
          : nothing}
      </li>
    `;
  }

  renderCategory(category) {
    return html`
      <section part="category" class="border-t border-slate-200 pt-3 first:border-t-0 first:pt-0 dark:border-slate-800">
        <h3
          part="category-heading"
          class="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
        >
          ${category.label}
        </h3>
        <ul class="divide-y divide-slate-100 dark:divide-slate-800">
          ${category.permissions.map((p) => this.renderPermission(p))}
        </ul>
      </section>
    `;
  }

  renderHeader() {
    const u = this.user;
    const held = new Set(this.grants.map((g) => g.permission_id)).size;
    const total = this.catalogue.length;
    const home = this.coverage.find((c) => Number(c.is_default) === 1);

    return html`
      <header part="header" class="flex flex-wrap items-start justify-between gap-2">
        <div>
          ${this.heading
            ? html`<h2
                part="heading"
                class="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
              >
                ${this.heading}
              </h2>`
            : nothing}
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">
            ${u.given_name} ${u.surname}
            <span class="font-mono text-xs font-normal opacity-70">(${u.username})</span>
          </p>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            ${home?.role_name ?? u.role_name ?? "No role"} ·
            ${home ? `${home.branch_code} — ${home.branch_name}` : "no default branch"}
            ${this.coverage.length > 1
              ? html` · ${this.coverage.length} branches`
              : nothing}
          </p>
          <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            ${held} of ${total} permissions
          </p>
        </div>
        ${isCollapsible(this.coverage)
          ? html`
              <label
                part="dense-toggle"
                class="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"
              >
                <input
                  type="checkbox"
                  class="accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  .checked=${this.dense}
                  @change=${() => this.toggleDense()}
                />
                Group branches
              </label>
            `
          : nothing}
      </header>
    `;
  }

  render() {
    if (!this.userId) return this.renderEmpty("No user — set userId to a signed-in app_user.");
    if (this.loading && !this.user) return this.renderSkeleton(4);
    if (this.error)
      return this.renderError(this.error, { onRetry: () => this.fetchPermissions({ force: true }) });
    if (!this.user) return this.renderEmpty(`No app_user ${this.userId}.`);

    const categories = this.categories;
    const anyLimited = categories.some((c) => c.permissions.some((p) => p.isLimited));

    return html`
      <section
        part="root"
        class="rounded-merchant border border-slate-200 bg-white p-4 text-slate-900
               dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        ${this.renderHeader()}

        ${categories.length
          ? html`<div class="mt-3 space-y-3">${categories.map((c) => this.renderCategory(c))}</div>`
          : html`<p part="empty" class="mt-3 text-sm text-slate-500 dark:text-slate-400">
              This account holds no permissions. Speak to your branch manager.
            </p>`}
        ${anyLimited
          ? html`<p
              part="legend"
              class="mt-4 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400"
            >
              Amounts are approval thresholds. Above the figure shown the transaction is sent
              for approval — it is not refused.
            </p>`
          : nothing}
      </section>
    `;
  }
}

customElements.define("merchant-user-permissions-view", MerchantUserPermissionsView);
