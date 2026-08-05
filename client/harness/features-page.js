// client/harness/features-page.js — the feature finder.
//
// "Which customer has more than two delivery addresses?" answered by asking the dataset
// rather than by consulting a list somebody has to remember to update. Every row states how
// many exist, names a few, and — where the feature belongs to a component — opens that
// component already in the state being asked about.
//
// Zero is a result, not a failure. A feature that should exist and does not is a documented
// upstream gap, and showing it is the point: it stops the same discovery being made twice.

import { LitElement, html, css, nothing } from "lit";
import { tw } from "../../src/styles/tailwind.css.js";
import { createApi } from "../../src/components/shared/api.js";
import { applyStoredTheme, toggleTheme } from "./theme.js";

const ENTITY_LABEL = {
  customer: "Customers",
  product: "Products",
  branch: "Branches",
  staff: "Staff",
  gap: "Known gaps",
};

class HarnessFeatures extends LitElement {
  static styles = [tw, css`:host { display: block; }`];

  static properties = {
    rows: { state: true },
    entities: { state: true },
    q: { state: true },
    entity: { state: true },
    asProspect: { state: true },
    loading: { state: true },
    tookMs: { state: true },
    error: { state: true },
  };

  #debounce = null;

  constructor() {
    super();
    this.rows = [];
    this.entities = [];
    this.q = "";
    this.entity = "";
    this.asProspect = false;
    this.loading = true;
    this.tookMs = 0;
    this.error = null;
    applyStoredTheme();
  }

  connectedCallback() {
    super.connectedCallback();
    document.title = "Feature finder · rm-merchant-components";
    this.fetch();
  }

  async fetch() {
    this.loading = true;
    try {
      const url = new URL("/api/harness/features", location.origin);
      if (this.q) url.searchParams.set("q", this.q);
      if (this.entity) url.searchParams.set("entity", this.entity);
      if (this.asProspect) url.searchParams.set("audience", "demo");
      const res = await fetch(url);
      const body = await res.json();
      this.rows = body.rows ?? [];
      this.entities = body.entities ?? [];
      this.tookMs = body.tookMs ?? 0;
      this.error = null;
    } catch (err) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  onSearch(e) {
    this.q = e.target.value;
    clearTimeout(this.#debounce);
    // Each keystroke re-runs every matching probe, and some of those cross 1.19M aged-debt
    // rows. Worth waiting for the typing to stop.
    this.#debounce = setTimeout(() => this.fetch(), 250);
  }

  toggleProspect() {
    this.asProspect = !this.asProspect;
    if (this.asProspect) this.entity = "";
    this.fetch();
  }

  setEntity(entity) {
    this.entity = this.entity === entity ? "" : entity;
    this.fetch();
  }

  // The whole point of the page: not "here is an id" but "here it is, on screen".
  linkFor(feature, example) {
    if (!feature.component || !example.props) return null;
    return `/c/${feature.component}?props=${encodeURIComponent(JSON.stringify(example.props))}`;
  }

  renderExample(feature, example) {
    const href = this.linkFor(feature, example);
    return html`
      <li class="flex flex-wrap items-baseline gap-x-2 py-0.5">
        <span class="font-mono text-xs text-slate-400 dark:text-slate-500">#${example.id}</span>
        <span class="text-slate-800 dark:text-slate-200">${example.label}</span>
        ${example.detail
          ? html`<span class="text-xs text-slate-500 dark:text-slate-400">— ${example.detail}</span>`
          : nothing}
        ${href
          ? html`<a
              href=${href}
              class="ml-auto shrink-0 text-xs font-medium text-sky-700 hover:underline dark:text-sky-300"
              >Open in ${feature.component} →</a
            >`
          : nothing}
      </li>
    `;
  }

  renderFeature(f) {
    const none = f.total === 0;
    return html`
      <article
        class="rounded-merchant border p-3 ${none
          ? "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}"
      >
        <header class="flex flex-wrap items-baseline gap-x-2">
          <h3 class="font-medium">${this.asProspect && f.demoLabel ? f.demoLabel : f.label}</h3>
          ${!this.asProspect
            ? html`<span
                class="rounded px-1.5 py-0.5 text-xs font-medium ${f.audience === "demo"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}"
                title=${f.audience === "demo"
                  ? "Shown to prospects on the demo surface"
                  : "Internal only — never reaches a prospect"}
                >${f.audience}</span
              >`
            : nothing}
          <span
            class="rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${none
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}"
            >${none ? "none in this dataset" : `${f.total.toLocaleString("en-GB")} in dataset`}</span
          >
          <span class="ml-auto font-mono text-xs text-slate-400 dark:text-slate-500">${f.id}</span>
        </header>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
          ${this.asProspect && f.demoWhy ? f.demoWhy : f.why}
        </p>
        ${f.error
          ? html`<p class="mt-2 font-mono text-xs text-red-700 dark:text-red-300">${f.error}</p>`
          : nothing}
        ${f.examples.length
          ? html`<ul class="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
              ${f.examples.map((e) => this.renderExample(f, e))}
            </ul>`
          : nothing}
      </article>
    `;
  }

  render() {
    const grouped = new Map();
    for (const f of this.rows) {
      if (!grouped.has(f.entity)) grouped.set(f.entity, []);
      grouped.get(f.entity).push(f);
    }

    return html`
      <main class="mx-auto max-w-4xl p-6">
        <div class="mb-4 flex items-baseline justify-between gap-4">
          <a href="/" class="text-sm text-sky-700 hover:underline dark:text-sky-300">← All components</a>
          <button
            class="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
            @click=${() => toggleTheme()}
          >
            Dark
          </button>
        </div>

        <h1 class="text-xl font-semibold">Feature finder</h1>
        <p class="mt-1 mb-4 text-sm text-slate-600 dark:text-slate-300">
          Which record demonstrates a given feature — asked of the dataset, so it stays true
          across a regeneration. Ids move with the seed; a written crib list does not.
        </p>

        <input
          type="search"
          .value=${this.q}
          placeholder="delivery address, quantity breaks, on stop, tally, gap…"
          class="w-full rounded-merchant border border-slate-300 bg-white px-3 py-2 text-sm
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          @input=${(e) => this.onSearch(e)}
        />

        <div class="mt-2 flex flex-wrap items-center gap-1 text-xs">
          ${this.entities.map(
            (e) => html`<button
              class="rounded px-2 py-1 font-medium ${this.entity === e
                ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}"
              @click=${() => this.setEntity(e)}
            >
              ${ENTITY_LABEL[e] ?? e}
            </button>`,
          )}
          <button
            class="rounded px-2 py-1 font-medium ${this.asProspect
              ? "bg-emerald-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}"
            title="Show only what the outward-facing catalogue would show, in its wording"
            @click=${() => this.toggleProspect()}
          >
            ${this.asProspect ? "✓ As a prospect sees it" : "As a prospect sees it"}
          </button>
          <span class="ml-auto text-slate-400 dark:text-slate-500">
            ${this.loading ? "running probes…" : `${this.rows.length} features · ${this.tookMs} ms`}
          </span>
        </div>

        ${this.error
          ? html`<p class="mt-4 rounded-merchant border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              ${this.error}
            </p>`
          : nothing}

        ${!this.loading && !this.rows.length
          ? html`<p class="mt-6 rounded-merchant border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
              Nothing matches “${this.q}”. Try a table name, a component, or “gap”.
            </p>`
          : nothing}

        ${[...grouped.entries()].map(
          ([entity, list]) => html`
            <section class="mt-6">
              <h2 class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                ${ENTITY_LABEL[entity] ?? entity}
              </h2>
              <div class="space-y-2">${list.map((f) => this.renderFeature(f))}</div>
            </section>
          `,
        )}
      </main>
    `;
  }
}

customElements.define("harness-features", HarnessFeatures);
