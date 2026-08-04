# delivery-address

`<merchant-delivery-address>` — where is this order going?

## Current version: 0.1.0

Reachable from anywhere in the order flow, not only from a "delivery" branch of it: a cash
sale can be concluded at the counter and delivered next Wednesday, and a collect order can
turn into a delivery as lines are added.

**The delivery details are the point, not the address.** A driver with a 26-tonne wagon needs
to know it is a muddy site wanting a hiab before setting off; the postcode is the easy part.
So the project reference leads each card, the unload method sits on the right, and
instructions render in amber rather than behind a disclosure.

Unload methods are shown in plain words — `tail_lift` is a database value nobody says aloud.

## Properties

| Property | Attribute | Type | Default | Notes |
|---|---|---|---|---|
| `customerId` | `customer-id` | number \| null | `null` | Whose addresses these are. |
| `selectedId` | `selected-id` | number \| null | `null` | Address to mark as chosen. |
| `includeArchived` | `include-archived` | boolean | `false` | See below. |
| `heading` | `heading` | string | `"Delivery address"` | Blank hides it. |
| `dense` | `dense` | boolean | `false` | Tighter cards, no what3words or phone. |

## Events

| Event | Detail | When |
|---|---|---|
| `merchant-delivery-address-selected` | `{ id, customerId, name, town, postcode, projectReference, unloadMethod, deliveryInstructions, what3words }` | A card is chosen. |

`unloadMethod` and `deliveryInstructions` travel with the selection because the order needs
them long after this component is gone — a hiab booking and a "call 30 mins before" both
change what the transport office does.

## The empty state is the common one

Only **14,601 of 39,452 customers** have any delivery address, so "none" is an ordinary
outcome rather than a failure. It reads *"No delivery address on file. This order is collect,
or a new address is needed."* — what to do next, not an error.

Customers who do have them hold **1 to 7**, averaging 4.

## Archived addresses

`includeArchived` is implemented but **currently changes nothing: the generated dataset has
zero archived rows**. The hidden-count line and the dimmed styling are therefore untested
against real data. Flagged rather than quietly assumed to work — if archived addresses
matter, that is a generation request for datagenerator2.

## Data

`customer_delivery_address`, via `GET /api/customers/:id/delivery-addresses?includeArchived=1`.
57,967 rows. Ordered by project reference then town, because someone delivering to "Kirkby
site" looks for the job, not the postcode.
