// src/components/shared/merchant-element.js — the base every component extends.
//
// Its job is to make the nine components look and behave like one library rather than
// nine independent widgets (docs/plan.md §10): one adopted Tailwind stylesheet, one set of
// loading/error/empty states, one way to reach the API, one event-emitting convention.

import { LitElement, css, html, nothing } from "lit";
import { tw } from "../../styles/tailwind.css.js";
import { createApi } from "./api.js";

export class MerchantElement extends LitElement {
  // Subclasses must spread these: `static styles = [...MerchantElement.styles, css`…`]`.
  // Lit does not merge styles up the prototype chain the way it merges properties.
  static styles = [
    tw,
    css`
      :host {
        display: block;
        font-family: var(--merchant-font, ui-sans-serif, system-ui, sans-serif);
      }
      :host([hidden]) {
        display: none;
      }
    `,
  ];

  static properties = {
    // Injected API implementation. Left null, the component builds the default HTTP one.
    api: { attribute: false },
    apiBase: { type: String, attribute: "api-base" },
    loading: { type: Boolean, state: true },
    error: { attribute: false, state: true },
  };

  #fallbackApi = null;
  #fallbackBase = null;

  constructor() {
    super();
    this.api = null;
    this.apiBase = "";
    this.loading = false;
    this.error = null;
  }

  // Resolved lazily and outside the reactive graph, so reading it during render never
  // schedules another update.
  get client() {
    if (this.api) return this.api;
    if (!this.#fallbackApi || this.#fallbackBase !== this.apiBase) {
      this.#fallbackApi = createApi({ base: this.apiBase });
      this.#fallbackBase = this.apiBase;
    }
    return this.#fallbackApi;
  }

  // Wraps a fetch so all nine components report loading and failure identically.
  async load(fn) {
    this.loading = true;
    this.error = null;
    try {
      return await fn();
    } catch (err) {
      this.error = err;
      return null;
    } finally {
      this.loading = false;
    }
  }

  // Events are namespaced, composed and bubbling so a host application can listen on an
  // ancestor rather than on each component (docs/plan.md §4).
  emit(name, detail) {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, composed: true }),
    );
  }

  renderError(err = this.error, { onRetry } = {}) {
    if (!err) return nothing;
    return html`
      <div
        part="error"
        role="alert"
        class="rounded-merchant border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      >
        <p class="font-medium">${err.message ?? "Something went wrong"}</p>
        ${err.url
          ? html`<p class="mt-1 font-mono text-xs opacity-70">${err.url}</p>`
          : nothing}
        ${onRetry
          ? html`<button
              class="mt-3 rounded border border-red-300 px-2 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
              @click=${onRetry}
            >
              Try again
            </button>`
          : nothing}
      </div>
    `;
  }

  renderEmpty(message) {
    return html`
      <p
        part="empty"
        class="rounded-merchant border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
      >
        ${message}
      </p>
    `;
  }

  // Skeleton rows rather than a spinner: the layout does not jump when data lands.
  renderSkeleton(rows = 3) {
    return html`
      <div part="loading" class="space-y-2" aria-busy="true" aria-live="polite">
        ${Array.from(
          { length: rows },
          () => html`<div class="h-16 animate-pulse rounded-merchant bg-slate-100 dark:bg-slate-800"></div>`,
        )}
      </div>
    `;
  }
}
