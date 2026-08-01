// client/harness/index-page.js — the component catalogue (docs/plan.md §6).
//
// Harness chrome renders in the light DOM so it uses the linked stylesheet directly.
// Only the components under test use shadow DOM.

import { LitElement, html, nothing } from "lit";
import { components, groups } from "../../src/components/registry.js";
import { createApi } from "../../src/components/shared/api.js";
import { applyStoredTheme, toggleTheme, currentTheme } from "./theme.js";

const STATUS = {
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  planned: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  blocked: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
};

class HarnessIndex extends LitElement {
  static properties = { dataset: { state: true }, theme: { state: true } };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.dataset = null;
    this.theme = currentTheme();
    applyStoredTheme();
  }

  async connectedCallback() {
    super.connectedCallback();
    try {
      this.dataset = await createApi().dataset();
    } catch {
      this.dataset = { error: true };
    }
  }

  renderCard(c) {
    const openable = c.status === "ready";
    const inner = html`
      <div class="flex items-start justify-between gap-3">
        <h3 class="font-semibold">${c.title}</h3>
        <span class="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-white dark:bg-slate-100 dark:text-slate-900">
          v${c.version}
        </span>
      </div>
      <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">${c.description}</p>
      ${c.blockedBy
        ? html`<p class="mt-2 text-xs text-amber-800 dark:text-amber-300">⚠ ${c.blockedBy}</p>`
        : nothing}
      <div class="mt-3 flex flex-wrap items-center gap-1.5">
        <span class="rounded px-1.5 py-0.5 text-xs font-medium ${STATUS[c.status]}">${c.status}</span>
        <span class="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">phase ${c.phase}</span>
        ${c.dataDeps.map(
          (d) =>
            html`<span class="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700">${d}</span>`,
        )}
      </div>
    `;

    const base =
      "block rounded-lg border p-4 text-left transition border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";

    return openable
      ? html`<a href="/c/${c.id}" class="${base} hover:border-slate-400 hover:shadow-sm dark:hover:border-slate-600">${inner}</a>`
      : html`<div class="${base} opacity-70">${inner}</div>`;
  }

  render() {
    const ds = this.dataset;
    return html`
      <div class="mx-auto max-w-5xl px-6 py-10">
        <header class="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 class="text-2xl font-bold">rm-merchant-components</h1>
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Development harness — open a component to tune and test it.
            </p>
          </div>
          <button
            class="rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700"
            @click=${() => (this.theme = toggleTheme())}
          >
            ${this.theme === "dark" ? "Light" : "Dark"}
          </button>
        </header>

        ${ds && !ds.error
          ? html`
              <div class="mb-8 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
                <p class="font-mono text-slate-500 dark:text-slate-400">${ds.dbPath}</p>
                <p class="mt-1 text-slate-600 dark:text-slate-300">
                  ${Object.entries(ds.counts)
                    .map(([t, n]) => `${t} ${n.toLocaleString("en-GB")}`)
                    .join("  ·  ")}
                  ${ds.hasIndexes
                    ? nothing
                    : html`<span class="ml-2 text-amber-700 dark:text-amber-300">· no explicit indexes (docs/plan.md §7.2)</span>`}
                </p>
              </div>
            `
          : nothing}

        ${groups.map(
          (g) => html`
            <section class="mb-10">
              <h2 class="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">${g}</h2>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                ${components.filter((c) => c.group === g).map((c) => this.renderCard(c))}
              </div>
            </section>
          `,
        )}
      </div>
    `;
  }
}

customElements.define("harness-index", HarnessIndex);
