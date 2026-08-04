// client/harness/flow-page.js — run several components as a sequence.
//
// The component page tests one component thoroughly. This tests the joins: whether the event
// A emits actually carries what B needs as props, and whether B reacts when it arrives. Those
// are the failures that survive per-component testing, because each component passes alone.
//
// The wire between steps is shown rather than hidden — the detail that flowed is the contract
// under test, so it should be on screen.

import { LitElement, html, nothing } from "lit";
import { flowById, flows, flowWarnings } from "./flows.js";
import { byId } from "../../src/components/registry.js";
import { createApi } from "../../src/components/shared/api.js";
import { instrumentApi } from "./instrumented-api.js";
import { applyStoredTheme, toggleTheme, currentTheme } from "./theme.js";

const LEVEL = {
  stop: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
};

class HarnessFlow extends LitElement {
  static properties = {
    flow: { state: true },
    ctx: { state: true },
    wire: { state: true },
    theme: { state: true },
    loadError: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.flow = null;
    this.ctx = {};
    this.wire = [];
    this.theme = currentTheme();
    this.loadError = null;
    this.elements = new Map();
    applyStoredTheme();
  }

  async connectedCallback() {
    super.connectedCallback();
    const id = decodeURIComponent(location.pathname.replace(/^\/f\//, "").replace(/\/$/, ""));
    this.flow = flowById(id);
    if (!this.flow) {
      this.loadError = `No flow "${id}". Try: ${flows.map((f) => f.id).join(", ")}`;
      return;
    }
    document.title = `${this.flow.title} · flow · rm-merchant-components`;

    try {
      await Promise.all(
        this.flow.steps.map((s) => import(byId(s.component).module)),
      );
    } catch (err) {
      this.loadError = `Failed to load a component — ${err.message}`;
      return;
    }
    this.requestUpdate();
  }

  // A step runs once every key in `needs` is present. Until then it says what it is waiting
  // for, which is more useful than an empty component that looks broken.
  ready(step) {
    return (step.needs ?? []).every((key) => this.ctx[key] !== undefined && this.ctx[key] !== null);
  }

  propsFor(step) {
    return typeof step.props === "function" ? step.props(this.ctx) : (step.props ?? {});
  }

  updated() {
    if (!this.flow) return;
    for (const [index, step] of this.flow.steps.entries()) {
      const mount = this.querySelector(`#step-${index}`);
      if (!mount) continue;
      if (!this.ready(step)) {
        mount.replaceChildren();
        this.elements.delete(index);
        continue;
      }

      let el = this.elements.get(index);
      if (!el) {
        const meta = byId(step.component);
        el = document.createElement(meta.tag);
        el.api = instrumentApi(createApi(), () => {});
        for (const [name, map] of Object.entries(step.emits ?? {})) {
          el.addEventListener(name, (e) => this.onStepEvent(index, step, name, map, e.detail));
        }
        this.elements.set(index, el);
        mount.replaceChildren(el);
      }
      Object.assign(el, this.propsFor(step));
    }
  }

  onStepEvent(index, step, name, map, detail) {
    const produced = map(detail) ?? {};
    this.wire = [
      { at: new Date(), from: step.component, event: name, produced, detail },
      ...this.wire,
    ].slice(0, 30);
    this.ctx = { ...this.ctx, ...produced };
  }

  reset() {
    this.ctx = {};
    this.wire = [];
    this.elements.clear();
    for (const [index] of this.flow.steps.entries()) {
      this.querySelector(`#step-${index}`)?.replaceChildren();
    }
    this.requestUpdate();
  }

  renderStep(step, index) {
    const meta = byId(step.component);
    const ready = this.ready(step);
    const missing = (step.needs ?? []).filter((k) => this.ctx[k] === undefined || this.ctx[k] === null);

    return html`
      <li class="relative">
        <div class="mb-2 flex flex-wrap items-baseline gap-2">
          <span
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold
                   ${ready
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}"
            >${index + 1}</span
          >
          <span class="font-medium">${step.note}</span>
          <a
            href="/c/${meta.id}"
            class="font-mono text-xs text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
            >&lt;${meta.tag}&gt; v${meta.version}</a
          >
        </div>

        <div class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          ${ready
            ? nothing
            : html`<p class="text-sm text-slate-500 dark:text-slate-400">
                Waiting for ${missing.join(", ")} — complete step ${index} first.
              </p>`}
          <div id="step-${index}"></div>
        </div>
      </li>
    `;
  }

  render() {
    if (this.loadError) {
      return html`<div class="mx-auto max-w-3xl p-10">
        <a href="/" class="text-sm underline">← All components</a>
        <p class="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">${this.loadError}</p>
      </div>`;
    }
    if (!this.flow) return nothing;

    const warnings = flowWarnings(this.ctx);

    return html`
      <div class="mx-auto max-w-[1500px] px-6 py-6">
        <header class="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <a href="/" class="text-sm text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
              >← All components</a
            >
            <h1 class="mt-1 text-xl font-bold">${this.flow.title}</h1>
            <p class="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">${this.flow.description}</p>
          </div>
          <div class="flex gap-2">
            <button
              class="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
              @click=${() => (this.theme = toggleTheme())}
            >
              ${this.theme === "dark" ? "Light" : "Dark"}
            </button>
            <button
              class="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
              @click=${() => this.reset()}
            >
              Start again
            </button>
          </div>
        </header>

        ${warnings.length
          ? html`<div class="mb-4 space-y-2">
              ${warnings.map(
                (w) => html`<p class="rounded-lg border px-3 py-2 text-sm font-medium ${LEVEL[w.level]}">
                  ${w.text}
                </p>`,
              )}
            </div>`
          : nothing}

        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <ol class="space-y-5">${this.flow.steps.map((s, i) => this.renderStep(s, i))}</ol>

          <aside class="space-y-4">
            <section class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                Context
              </h2>
              ${Object.keys(this.ctx).length
                ? html`<dl class="space-y-1 text-xs">
                    ${Object.entries(this.ctx).map(
                      ([k, v]) => html`<div class="flex justify-between gap-2">
                        <dt class="font-mono text-slate-500 dark:text-slate-400">${k}</dt>
                        <dd class="truncate font-medium">${String(v)}</dd>
                      </div>`,
                    )}
                  </dl>`
                : html`<p class="text-xs text-slate-500 dark:text-slate-400">Nothing yet.</p>`}
            </section>

            <section class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                Wire ${this.wire.length ? `(${this.wire.length})` : ""}
              </h2>
              ${this.wire.length
                ? html`<ul class="space-y-2">
                    ${this.wire.map(
                      (w) => html`<li class="rounded border border-slate-200 p-2 dark:border-slate-700">
                        <p class="font-mono text-xs font-medium">${w.event}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400">
                          from ${w.from} · ${w.at.toLocaleTimeString("en-GB")}
                        </p>
                        <pre class="mt-1 overflow-x-auto text-xs text-slate-600 dark:text-slate-300">${JSON.stringify(w.produced, null, 1)}</pre>
                      </li>`,
                    )}
                  </ul>`
                : html`<p class="text-xs text-slate-500 dark:text-slate-400">
                    Nothing has flowed between steps yet.
                  </p>`}
            </section>
          </aside>
        </div>
      </div>
    `;
  }
}

customElements.define("harness-flow", HarnessFlow);
