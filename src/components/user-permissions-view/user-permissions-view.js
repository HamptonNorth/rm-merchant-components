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
import { groupGrants, isCollapsible, groupBranchesByAccess } from "../shared/permissions.js";

export class MerchantUserPermissionsView extends MerchantElement {
  static version = "0.2.0";

  static styles = [...MerchantElement.styles];

  static properties = {
    userId: { type: Number, attribute: "user-id" },
    // The branch chosen at sign-in (<merchant-working-branch>). Set, the card answers
    // "what can I do here" and everything else moves behind a disclosure. Unset, it stays
    // the whole-profile view it was at v0.1.0, which is what an admin screen wants.
    workingBranchId: { type: Number, attribute: "working-branch-id" },
    dense: { type: Boolean },
    heading: { type: String },
    showDescriptions: { type: Boolean, attribute: "show-descriptions" },
    expanded: { type: Boolean },
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
      name: "workingBranchId",
      type: "number",
      default: null,
      description:
        "The branch chosen at sign-in. Set, the card shows what this user can do there and puts other branches behind a link. Blank shows the whole profile across every branch, as an admin screen would want.",
    },
    {
      name: "expanded",
      type: "boolean",
      default: false,
      description:
        "Open the other-branches section. Only appears when a working branch is set and the user covers more than one.",
    },
    {
      name: "dense",
      type: "boolean",
      default: true,
      description:
        "Collapse branches to ranges where the permission and limit are the same. Off lists every branch. Hidden when there is one branch in view, since there is nothing to collapse.",
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
    this.workingBranchId = null;
    this.dense = true;
    this.heading = "Your permissions";
    this.showDescriptions = true;
    this.expanded = false;
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

  // The branch the card is currently about, or null when showing the whole profile.
  get workingBranch() {
    if (this.workingBranchId == null) return null;
    return (
      this.coverage.find((c) => Number(c.branch_id) === Number(this.workingBranchId)) ?? null
    );
  }

  get isScoped() {
    return this.workingBranchId != null;
  }

  // Scoped, the coverage list is one branch — which is what makes renderPermission drop the
  // "where" line and the density toggle disappear. Neither needed a special case.
  //
  // Scoped to a branch the user does NOT cover, both lists are empty rather than falling
  // back to the whole profile. Silently widening to every branch would answer a question
  // nobody asked, and would tell someone standing at a branch they have no access to that
  // they hold fifteen permissions.
  get scopedCoverage() {
    if (!this.isScoped) return this.coverage;
    const branch = this.workingBranch;
    return branch ? [branch] : [];
  }

  get scopedGrants() {
    if (!this.isScoped) return this.grants;
    if (!this.workingBranch) return [];
    return this.grants.filter((g) => Number(g.branch_id) === Number(this.workingBranchId));
  }

  get categories() {
    return groupGrants({
      grants: this.scopedGrants,
      coverage: this.scopedCoverage,
      dense: this.dense,
    });
  }

  // Other branches, grouped by what the user can actually do at each.
  get otherBranchGroups() {
    if (!this.isScoped) return [];
    return groupBranchesByAccess({
      grants: this.grants,
      coverage: this.coverage,
      workingBranchId: this.workingBranchId,
    });
  }

  toggleExpanded() {
    this.expanded = !this.expanded;
    this.emit("merchant-user-permissions-expanded", {
      userId: this.userId,
      workingBranchId: this.workingBranchId,
      expanded: this.expanded,
    });
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
    const showWhere = this.scopedCoverage.length > 1;
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
    // Scoped, the count must be what applies HERE. "15 of 15 permissions" while standing at
    // a branch where only 3 of them work would be the same class of lie as the old
    // working-branch notice.
    const held = new Set(this.scopedGrants.map((g) => g.permission_id)).size;
    const total = this.catalogue.length;
    const working = this.workingBranch;
    const home = this.coverage.find((c) => Number(c.is_default) === 1);
    // Scoped to a branch they do not cover, falling back to their home branch would print
    // "Chester" above a body saying they have no access — two answers to one question.
    const denied = this.isScoped && !working;
    const place = denied ? null : (working ?? home);

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
            ${place?.role_name ?? u.role_name ?? "No role"} ·
            ${denied
              ? html`<span class="text-red-700 dark:text-red-400">not one of your branches</span>`
              : place
                ? `${place.branch_code} — ${place.branch_name}`
                : "no default branch"}
            ${working && Number(working.is_default) !== 1
              ? html` · <span class="text-sky-700 dark:text-sky-300">not your default</span>`
              : nothing}
            ${!this.isScoped && this.coverage.length > 1
              ? html` · ${this.coverage.length} branches`
              : nothing}
          </p>
          <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            ${held} of ${total} permissions${this.isScoped ? " here" : ""}
          </p>
        </div>
        ${isCollapsible(this.scopedCoverage)
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

  // One group per distinct set of access, not one per branch. A group identical to the
  // working branch is named and left at that — repeating fifteen identical permissions
  // under a Warrington heading answers nothing the words "same as here" do not.
  renderOtherBranchGroup(group) {
    const working = this.workingBranch;
    const count = group.permissionCount;

    return html`
      <section part="other-branch" class="border-t border-slate-200 pt-2 dark:border-slate-800">
        <p class="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span class="font-medium text-slate-900 dark:text-slate-100">${group.where}</span>
          ${group.sameAsWorking
            ? html`<span class="text-slate-500 dark:text-slate-400"
                >— same as ${working.branch_name}</span
              >`
            : html`<span class="text-slate-500 dark:text-slate-400"
                >— ${count} of ${this.catalogue.length} permissions</span
              >`}
        </p>
        ${group.sameAsWorking
          ? nothing
          : count === 0
            ? html`<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Nothing — you cannot work from
                ${group.branchIds.length === 1 ? "this branch" : "these branches"}.
              </p>`
            : html`<div class="mt-1.5 space-y-2">
                ${groupGrants({
                  grants: group.grants,
                  // One branch's worth of shape, so rows render without a "where" line.
                  coverage: [this.coverage.find((c) => Number(c.branch_id) === group.branchIds[0])],
                  dense: true,
                }).map((c) => this.renderCategory(c))}
              </div>`}
      </section>
    `;
  }

  renderOtherBranches() {
    const groups = this.otherBranchGroups;
    if (!this.isScoped || !groups.length) return nothing;

    const branchCount = groups.reduce((n, g) => n + g.branchIds.length, 0);

    return html`
      <div part="other-branches" class="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
        <button
          part="expand"
          type="button"
          aria-expanded=${this.expanded ? "true" : "false"}
          class="flex w-full items-center justify-between gap-2 text-left text-xs font-medium
                 text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2
                 focus-visible:outline-accent dark:text-sky-300"
          @click=${() => this.toggleExpanded()}
        >
          <span>
            You also have permissions at ${branchCount}
            ${branchCount === 1 ? "other branch" : "other branches"}
          </span>
          <span aria-hidden="true">${this.expanded ? "Hide" : "Show"}</span>
        </button>
        ${this.expanded
          ? html`<div class="mt-2 space-y-2">
              ${groups.map((g) => this.renderOtherBranchGroup(g))}
            </div>`
          : nothing}
      </div>
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
          : this.isScoped && !this.workingBranch
            ? html`<p part="empty" class="mt-3 text-sm font-medium text-red-700 dark:text-red-400">
                You have no permissions at this branch and cannot work from it.
              </p>`
            : html`<p part="empty" class="mt-3 text-sm text-slate-500 dark:text-slate-400">
                This account holds no permissions. Speak to your branch manager.
              </p>`}
        ${this.renderOtherBranches()}
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
