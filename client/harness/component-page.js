// client/harness/component-page.js — the development surface for one component
// (docs/plan.md §6): stage, props panel, scenarios, event log and request log.
//
// The component under test is created imperatively and kept as a reference, so the
// harness sets properties on it directly — exactly as a host application would.

import { LitElement, html, nothing } from "lit";
import { byId } from "../../src/components/registry.js";
import { createApi } from "../../src/components/shared/api.js";
import { instrumentApi } from "./instrumented-api.js";
import { applyStoredTheme, toggleTheme, currentTheme } from "./theme.js";

const VIEWPORTS = [
  { id: "360", label: "360", width: "360px" },
  { id: "768", label: "768", width: "768px" },
  { id: "1280", label: "1280", width: "1280px" },
  { id: "fluid", label: "Fluid", width: "100%" },
];

const TABS = ["Props", "Scenarios", "Events", "Requests", "Embed"];

class HarnessComponent extends LitElement {
  static properties = {
    meta: { state: true },
    props: { state: true },
    events: { state: true },
    requests: { state: true },
    tab: { state: true },
    viewport: { state: true },
    theme: { state: true },
    scenarios: { state: true },
    loadError: { state: true },
    schema: { state: true },
    pageErrors: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.meta = null;
    this.props = {};
    this.events = [];
    this.requests = [];
    this.tab = "Props";
    this.viewport = "fluid";
    this.theme = currentTheme();
    this.scenarios = [];
    this.loadError = null;
    this.schema = [];
    this.pageErrors = [];
    this.el = null;
    this.ctor = null;
    applyStoredTheme();
  }

  async connectedCallback() {
    super.connectedCallback();

    // When render() throws, Lit leaves the previously rendered DOM in place. Without this
    // the component just looks stuck on a stale state — an empty message, an old list —
    // with nothing to say it failed. Surfacing uncaught errors turns a confusing silence
    // into an obvious red banner.
    const record = (message, stack) => {
      this.pageErrors = [{ message, stack, at: new Date() }, ...this.pageErrors].slice(0, 20);
    };
    window.addEventListener("error", (e) => record(e.message, e.error?.stack));
    window.addEventListener("unhandledrejection", (e) =>
      record(e.reason?.message ?? String(e.reason), e.reason?.stack),
    );
    const id = decodeURIComponent(location.pathname.replace(/^\/c\//, "").replace(/\/$/, ""));
    this.meta = byId(id);
    if (!this.meta) {
      this.loadError = `No component "${id}" in the registry.`;
      return;
    }
    document.title = `${this.meta.title} · rm-merchant-components`;

    try {
      const mod = await import(this.meta.module);
      this.ctor = Object.values(mod).find((v) => typeof v === "function" && v.harnessSchema);
      this.schema = this.ctor?.harnessSchema ?? [];
      this.props = Object.fromEntries(this.schema.map((f) => [f.name, f.default]));
      // ?props={"customerId":123} — how the feature finder opens a component already in the
      // state being asked about, rather than leaving an id to be typed in by hand.
      const raw = new URLSearchParams(location.search).get("props");
      if (raw) {
        try {
          const incoming = JSON.parse(raw);
          for (const [k, v] of Object.entries(incoming)) {
            if (k in this.props) this.props[k] = v;
          }
        } catch (err) {
          this.loadError = `Bad ?props= in the URL — ${err.message}`;
        }
      }
      this.buildElement();
    } catch (err) {
      this.loadError = `Failed to load ${this.meta.module} — ${err.message}`;
      return;
    }

    try {
      const res = await createApi().listScenarios({ component: id });
      this.scenarios = res.rows;
    } catch {
      this.scenarios = [];
    }
  }

  // (Re)create the element under test. Used on first load and by Remount, which is the
  // only way to re-exercise connectedCallback and the component's initial fetch.
  buildElement() {
    const el = document.createElement(this.meta.tag);
    el.api = instrumentApi(createApi(), (entry) => {
      this.requests = [entry, ...this.requests].slice(0, 50);
    });
    el.dataset.theme = this.theme;
    for (const [k, v] of Object.entries(this.props)) el[k] = v;
    for (const name of this.meta.events ?? []) {
      el.addEventListener(name, (e) => {
        this.events = [{ type: e.type, detail: e.detail, at: new Date() }, ...this.events].slice(0, 50);
      });
    }
    this.el = el;
    this.requestUpdate();
  }

  updated() {
    const mount = this.querySelector("#stage-mount");
    if (mount && this.el && this.el.parentNode !== mount) {
      mount.replaceChildren(this.el);
    }
  }

  setProp(name, value) {
    this.props = { ...this.props, [name]: value };
    if (this.el) this.el[name] = value;
  }

  applyScenario(s) {
    for (const [k, v] of Object.entries(s.props ?? {})) this.setProp(k, v);
  }

  remount() {
    this.events = [];
    this.requests = [];
    this.pageErrors = [];
    this.buildElement();
  }

  switchTheme() {
    this.theme = toggleTheme();
    if (this.el) this.el.dataset.theme = this.theme;
  }

  // ---- panels -------------------------------------------------------------

  renderProps() {
    if (!this.schema.length) {
      return html`<p class="text-sm text-slate-500">This component declares no harnessSchema.</p>`;
    }
    return html`
      <div class="space-y-4">
        ${this.schema.map((f) => {
          const value = this.props[f.name];
          return html`
            <label class="block">
              <span class="flex items-baseline gap-2">
                <span class="font-mono text-xs font-medium">${f.name}</span>
                <span class="text-xs text-slate-400">${f.type}</span>
              </span>
              ${f.type === "boolean"
                ? html`<input
                    type="checkbox"
                    class="mt-1"
                    .checked=${Boolean(value)}
                    @change=${(e) => this.setProp(f.name, e.target.checked)}
                  />`
                : f.type === "select"
                  ? html`<select
                      class="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                      .value=${value ?? ""}
                      @change=${(e) => this.setProp(f.name, e.target.value)}
                    >
                      ${(f.options ?? []).map(
                        (o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`,
                      )}
                    </select>`
                  : html`<input
                      type=${f.type === "number" ? "number" : "text"}
                      class="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                      placeholder=${f.type === "csv" ? "01,02,31" : ""}
                      .value=${value === null || value === undefined
                        ? ""
                        : Array.isArray(value)
                          ? value.join(",")
                          : String(value)}
                      @input=${(e) => {
                        const raw = e.target.value;
                        if (f.type === "number") {
                          this.setProp(f.name, raw === "" ? null : Number(raw));
                        } else if (f.type === "csv") {
                          // The property is a real array; the control is a text field.
                          const codes = raw
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean);
                          this.setProp(f.name, codes.length ? codes : null);
                        } else {
                          this.setProp(f.name, raw);
                        }
                      }}
                    />`}
              <span class="mt-1 block text-xs text-slate-500 dark:text-slate-400">${f.description}</span>
            </label>
          `;
        })}
      </div>
    `;
  }

  renderScenarios() {
    if (!this.scenarios.length) {
      return html`<p class="text-sm text-slate-500">No scenarios registered for this component.</p>`;
    }
    return html`
      <ul class="space-y-2">
        ${this.scenarios.map(
          (s) => html`
            <li>
              <button
                class="w-full rounded border border-slate-200 p-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                ?disabled=${!s.available}
                @click=${() => this.applyScenario(s)}
              >
                <span class="font-medium">${s.label}</span>
                ${s.available
                  ? html`<span class="mt-0.5 block font-mono text-xs text-slate-500">${JSON.stringify(s.props)}</span>`
                  : html`<span class="mt-0.5 block text-xs text-amber-700">unavailable in this dataset</span>`}
              </button>
            </li>
          `,
        )}
      </ul>
    `;
  }

  renderEvents() {
    if (!this.events.length) {
      return html`<p class="text-sm text-slate-500">
        Nothing yet. Declared: ${(this.meta.events ?? []).map((e) => html`<code class="font-mono text-xs">${e}</code> `)}
      </p>`;
    }
    return html`
      <ul class="space-y-2">
        ${this.events.map(
          (e) => html`
            <li class="rounded border border-slate-200 p-2 dark:border-slate-700">
              <div class="flex items-baseline justify-between gap-2">
                <code class="font-mono text-xs font-medium">${e.type}</code>
                <span class="text-xs text-slate-400">${e.at.toLocaleTimeString("en-GB")}</span>
              </div>
              <pre class="mt-1 overflow-x-auto text-xs text-slate-600 dark:text-slate-300">${JSON.stringify(e.detail, null, 2)}</pre>
            </li>
          `,
        )}
      </ul>
    `;
  }

  renderRequests() {
    if (!this.requests.length) {
      return html`<p class="text-sm text-slate-500">No API calls yet.</p>`;
    }
    return html`
      <ul class="space-y-2">
        ${this.requests.map(
          (r) => html`
            <li class="rounded border p-2 ${r.warnings?.length ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950" : "border-slate-200 dark:border-slate-700"}">
              <div class="flex items-baseline justify-between gap-2">
                <code class="truncate font-mono text-xs">${r.url || r.method}</code>
                <span class="shrink-0 text-xs ${r.ok ? "text-slate-400" : "text-red-600"}">
                  ${r.ok ? `${r.tookMs ?? "?"} ms · ${r.rows ?? 0} rows` : `error ${r.status}`}
                </span>
              </div>
              ${r.error ? html`<p class="mt-1 text-xs text-red-600">${r.error}</p>` : nothing}
              ${r.plan?.length
                ? html`<pre class="mt-1 overflow-x-auto text-xs text-slate-500 dark:text-slate-400">${r.plan.join("\n")}</pre>`
                : nothing}
              ${r.warnings?.length
                ? html`<p class="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                    ⚠ full scan or temp b-tree — an index would remove this (docs/plan.md §7.2).
                    Try: <code class="font-mono">bun run explain --sql "…" --index "…"</code>
                  </p>`
                : nothing}
            </li>
          `,
        )}
      </ul>
    `;
  }

  renderEmbed() {
    const attrFor = (name) => this.ctor?.elementProperties?.get(name)?.attribute;
    const attrs = Object.entries(this.props)
      .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false)
      .map(([k, v]) => {
        const attr = attrFor(k);
        const attrName = typeof attr === "string" ? attr : k.toLowerCase();
        return v === true ? `  ${attrName}` : `  ${attrName}="${v}"`;
      });

    const snippet =
      `<script type="module" src="${this.meta.module}"></script>\n\n` +
      `<${this.meta.tag}\n${attrs.join("\n")}\n></${this.meta.tag}>`;

    return html`
      <p class="mb-2 text-sm text-slate-600 dark:text-slate-400">
        Markup to embed this component at its current settings. Version
        <span class="font-mono">${this.ctor?.version ?? this.meta.version}</span>.
      </p>
      <pre class="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">${snippet}</pre>
      <button
        class="mt-2 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
        @click=${() => navigator.clipboard?.writeText(snippet)}
      >
        Copy
      </button>
    `;
  }

  render() {
    if (this.loadError) {
      return html`<div class="mx-auto max-w-3xl p-10">
        <a href="/" class="text-sm underline">← All components</a>
        <p class="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">${this.loadError}</p>
      </div>`;
    }
    if (!this.meta) return nothing;

    const width = VIEWPORTS.find((v) => v.id === this.viewport)?.width ?? "100%";
    const runtimeVersion = this.ctor?.version;
    const drift = runtimeVersion && runtimeVersion !== this.meta.version;

    return html`
      <div class="mx-auto max-w-[1600px] px-6 py-6">
        <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <a href="/" class="text-sm text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200">← All components</a>
            <h1 class="mt-1 flex items-center gap-2 text-xl font-bold">
              ${this.meta.title}
              <span class="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-white dark:bg-slate-100 dark:text-slate-900">
                v${runtimeVersion ?? this.meta.version}
              </span>
              ${drift
                ? html`<span class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900" title="registry says v${this.meta.version}">
                    registry mismatch
                  </span>`
                : nothing}
            </h1>
            <p class="mt-1 font-mono text-xs text-slate-500">&lt;${this.meta.tag}&gt;</p>
          </div>

          <div class="flex items-center gap-2">
            ${VIEWPORTS.map(
              (v) => html`<button
                class="rounded border px-2 py-1 text-xs ${this.viewport === v.id
                  ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                  : "border-slate-300 dark:border-slate-700"}"
                @click=${() => (this.viewport = v.id)}
              >
                ${v.label}
              </button>`,
            )}
            <button class="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700" @click=${() => this.switchTheme()}>
              ${this.theme === "dark" ? "Light" : "Dark"}
            </button>
            <button class="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700" @click=${() => this.remount()}>
              Remount
            </button>
          </div>
        </header>

        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]">
          <main class="min-w-0">
            ${this.pageErrors.length
              ? html`
                  <div
                    class="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950"
                    role="alert"
                  >
                    <p class="text-sm font-semibold text-red-900 dark:text-red-100">
                      ${this.pageErrors.length} uncaught
                      ${this.pageErrors.length === 1 ? "error" : "errors"} — what you see below
                      may be stale
                    </p>
                    ${this.pageErrors.slice(0, 3).map(
                      (e) => html`
                        <p class="mt-2 font-mono text-xs text-red-800 dark:text-red-200">
                          ${e.message}
                        </p>
                        ${e.stack
                          ? html`<pre class="mt-1 max-h-32 overflow-auto text-xs text-red-700 dark:text-red-300">${e.stack}</pre>`
                          : nothing}
                      `,
                    )}
                  </div>
                `
              : nothing}
            <div class="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div id="stage-mount" style="width:${width}; max-width:100%; margin:0 auto;"></div>
            </div>
          </main>

          <aside class="min-w-0">
            <nav class="mb-3 flex flex-wrap gap-1">
              ${TABS.map(
                (t) => html`<button
                  class="rounded px-2 py-1 text-xs font-medium ${this.tab === t
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"}"
                  @click=${() => (this.tab = t)}
                >
                  ${t}${t === "Events" && this.events.length ? ` (${this.events.length})` : ""}${t === "Requests" && this.requests.length ? ` (${this.requests.length})` : ""}
                </button>`,
              )}
            </nav>
            <div class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              ${this.tab === "Props" ? this.renderProps() : nothing}
              ${this.tab === "Scenarios" ? this.renderScenarios() : nothing}
              ${this.tab === "Events" ? this.renderEvents() : nothing}
              ${this.tab === "Requests" ? this.renderRequests() : nothing}
              ${this.tab === "Embed" ? this.renderEmbed() : nothing}
            </div>
          </aside>
        </div>
      </div>
    `;
  }
}

customElements.define("harness-component", HarnessComponent);
