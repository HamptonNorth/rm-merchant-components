// delivery-address v0.1.0 — where is this order going?
//
// A cash sale can be concluded at the counter and delivered next Wednesday, and a collect
// order can turn into a delivery as lines are added, so this is reachable from anywhere in
// the order flow rather than only from a "delivery" branch of it.
//
// The delivery details are the point, not the address. A driver with a 26-tonne wagon needs
// to know it is a muddy site wanting a hiab before setting off; the postcode is the easy
// part. So unload method and instructions sit on the card rather than behind it.

import { html, css, nothing } from "lit";
import { MerchantElement } from "../shared/merchant-element.js";
import { fmtDate, addressLines } from "../shared/format.js";

// Plain words, because "tail_lift" is a database value and nobody says it out loud.
const UNLOAD = {
  hiab: { label: "Hiab", note: "Lorry-mounted crane" },
  forklift: { label: "Forklift", note: "Site forklift required" },
  tail_lift: { label: "Tail lift", note: "Tail lift and pump truck" },
  hand: { label: "Hand ball", note: "Unloaded by hand" },
};

export class MerchantDeliveryAddress extends MerchantElement {
  static version = "0.1.0";

  static styles = [
    ...MerchantElement.styles,
    css`
      :host {
        container-type: inline-size;
        display: block;
      }
    `,
  ];

  static properties = {
    customerId: { type: Number, attribute: "customer-id" },
    selectedId: { type: Number, attribute: "selected-id" },
    includeArchived: { type: Boolean, attribute: "include-archived" },
    heading: { type: String },
    dense: { type: Boolean },
    addresses: { attribute: false, state: true },
    archivedCount: { state: true },
  };

  static harnessSchema = [
    {
      name: "customerId",
      type: "number",
      default: 9,
      description:
        "Customer whose delivery addresses these are. Only 14,601 of 39,452 customers have any, so the empty state is common — try 1 for that.",
    },
    {
      name: "selectedId",
      type: "number",
      default: null,
      description: "Address id to mark as chosen.",
    },
    {
      name: "includeArchived",
      type: "boolean",
      default: false,
      description:
        "Show archived addresses too. The generated dataset has none, so this currently changes nothing — see the component doc.",
    },
    {
      name: "heading",
      type: "string",
      default: "Delivery address",
      description: "Visible heading. Blank hides it.",
    },
    { name: "dense", type: "boolean", default: false, description: "Tighter cards." },
  ];

  constructor() {
    super();
    this.customerId = null;
    this.selectedId = null;
    this.includeArchived = false;
    this.heading = "Delivery address";
    this.dense = false;
    this.addresses = [];
    this.archivedCount = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchAddresses();
  }

  updated(changed) {
    if (changed.has("customerId") || changed.has("includeArchived") || changed.has("api")) {
      this.fetchAddresses();
    }
  }

  async fetchAddresses() {
    if (!this.customerId) {
      this.addresses = [];
      this.archivedCount = 0;
      return;
    }
    const result = await this.load(() =>
      this.client.listDeliveryAddresses({
        customerId: this.customerId,
        includeArchived: this.includeArchived,
      }),
    );
    if (!result) return;
    this.addresses = result.rows ?? [];
    this.archivedCount = result.archivedCount ?? 0;
  }

  select(address) {
    this.selectedId = address.id;
    this.emit("merchant-delivery-address-selected", {
      id: address.id,
      customerId: this.customerId,
      name: address.name,
      postcode: address.postcode,
      town: address.town,
      projectReference: address.project_reference || null,
      unloadMethod: address.unload_method,
      // Carried because the order needs it long after this component is gone: a hiab
      // booking and a "call 30 mins before" both change what the transport office does.
      deliveryInstructions: address.delivery_instructions || null,
      what3words: address.what3words || null,
    });
  }

  renderAddress(address) {
    const selected = address.id === this.selectedId;
    const unload = UNLOAD[address.unload_method] ?? { label: address.unload_method, note: null };
    const lines = addressLines(address, ["address_1", "address_2"]);

    return html`
      <li>
        <button
          part=${selected ? "address address-selected" : "address"}
          type="button"
          aria-pressed=${selected ? "true" : "false"}
          class="w-full rounded-merchant border border-l-2 text-left transition
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                 ${this.dense ? "p-2" : "p-3"}
                 ${selected
            ? "border-l-accent border-accent bg-accent-soft dark:bg-slate-800"
            : "border-l-transparent border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"}
                 ${address.archived ? "opacity-60" : ""}"
          @click=${() => this.select(address)}
        >
          <span class="flex flex-wrap items-baseline gap-x-2">
            ${address.project_reference
              ? html`<span
                  class="rounded bg-slate-900 px-1.5 py-0.5 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                  >${address.project_reference}</span
                >`
              : nothing}
            <span class="font-medium text-slate-900 dark:text-slate-100">${address.name}</span>
            ${address.archived
              ? html`<span class="text-xs font-medium text-amber-700 dark:text-amber-300">Archived</span>`
              : nothing}
            <span class="ml-auto shrink-0 text-xs text-slate-500 dark:text-slate-400"
              >${unload.label}</span
            >
          </span>

          <span class="mt-0.5 block text-sm text-slate-600 dark:text-slate-400">
            ${lines.join(", ")}${lines.length ? ", " : ""}${address.town}
            <span class="font-mono">${address.postcode}</span>
          </span>

          ${address.delivery_instructions
            ? html`<span
                part="instructions"
                class="mt-1 block text-xs font-medium text-amber-800 dark:text-amber-300"
                >${address.delivery_instructions}</span
              >`
            : nothing}

          ${this.dense
            ? nothing
            : html`
                <span class="mt-1 flex flex-wrap items-baseline gap-x-3 text-xs text-slate-500 dark:text-slate-400">
                  ${address.what3words
                    ? html`<span class="font-mono">${address.what3words}</span>`
                    : nothing}
                  ${address.telephone ? html`<span>${address.telephone}</span>` : nothing}
                  ${address.added ? html`<span>Added ${fmtDate(address.added)}</span>` : nothing}
                </span>
              `}
        </button>
      </li>
    `;
  }

  render() {
    if (!this.customerId) return this.renderEmpty("No customer — set customerId.");
    if (this.loading && !this.addresses.length) return this.renderSkeleton(3);
    if (this.error) return this.renderError(this.error, { onRetry: () => this.fetchAddresses() });

    if (!this.addresses.length) {
      // Most customers have none, so this is an ordinary outcome rather than a failure —
      // the wording says what to do next instead of implying something went wrong.
      return html`<div part="root">
        ${this.heading ? this.renderHeading() : nothing}
        <p part="empty" class="rounded-merchant border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No delivery address on file. This order is collect, or a new address is needed.
        </p>
      </div>`;
    }

    return html`
      <section part="root">
        ${this.heading ? this.renderHeading() : nothing}
        <ul class="grid grid-cols-1 gap-2 @2xl:grid-cols-2">
          ${this.addresses.map((a) => this.renderAddress(a))}
        </ul>
        ${this.archivedCount && !this.includeArchived
          ? html`<p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
              ${this.archivedCount} archived
              ${this.archivedCount === 1 ? "address" : "addresses"} hidden.
            </p>`
          : nothing}
      </section>
    `;
  }

  renderHeading() {
    return html`<h2
      part="heading"
      class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
    >
      ${this.heading}
      <span class="ml-1 font-normal normal-case opacity-70"
        >${this.addresses.length || ""}</span
      >
    </h2>`;
  }
}

customElements.define("merchant-delivery-address", MerchantDeliveryAddress);
