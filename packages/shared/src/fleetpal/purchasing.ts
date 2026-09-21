import { z } from "zod";
import { fleetpalId, money, timestamp } from "./primitives.js";

/**
 * The catalogue, the people, and the paperwork that buys parts.
 *
 * Two of these shapes carry the integration's load-bearing facts:
 *
 * **`Part` proves D-INV10 rather than merely agreeing with it.** There is no quantity here, no
 * location, no reorder point, and no stock endpoint anywhere in the vendor's API. FleetPal models
 * the part DEFINITION and the repair JOB; on-hand simply is not in its model. So "the shelf is
 * ours" is the vendor's own architecture, and D-FP11 follows: FleetPal supplies the catalogue and
 * the opening balance comes from a physical count.
 *
 * **`POInvoice` is the far side of the coverage bridge** (§2.4, D-FP4). The chain
 * `work_order → purchase-orders?work_order= → purchase-order-invoices` yields the VENDOR's own
 * invoice number and the vendor to pay, and `mcleod_ap_vouchers` holds `invoice_number` and
 * `vendor_id`. Joining them measures what fraction of the GL maintenance family FleetPal saw. The
 * result is a RATIO, so no dollar crosses into Finance and D-FLEET2 is not reopened.
 */

// ── the catalogue ───────────────────────────────────────────────────────────────────────────────

/**
 * The `Part.type` members observed on the live account, 2026-09-21. **Not from the spec** — the
 * spec says this field is an integer (see `fleetpalPartSchema`), so there is no `PartTypeEnum` to check against
 * and this list is measured, not derived. A value outside it is not an error; it is a thing to look
 * at, which is exactly what the F12 catalogue sync must decide about.
 */
export const FLEETPAL_PART_TYPES = ["VENDOR_HIDDEN"] as const;

/**
 * A catalogue part. **No quantity — see the file header.**
 *
 * ⚠ **`serialized_part` is a gift rather than a gap.** FleetPal already marks which entries are
 * tracked by individual serial number, which is our §2.1 seam — stock is fungible, an asset has an
 * identity — arriving pre-decided. A serialized part is an ASSET TYPE candidate on our side, not a
 * stock line. F12 flags it and does not auto-create: the vendor's flag says the part CAN be
 * serialized, and whether we track it that way is our decision about our shelf.
 *
 * `position_applicable` says a wheel or axle position is recorded when this part is fitted — but
 * `JobItem` carries no position VALUE (§2.10.3), so per-position tyre history is not derivable
 * however useful it would be. The flag is stored; nothing can act on it yet.
 *
 * ⚠ **`type` is where the spec and the live server disagree** (measured F4, 2026-09-21). The
 * document declares `{"type": "integer", "readOnly": true}` and describes it as distinguishing our
 * own catalogue entries from ones that arrived on a vendor's quote; the account answers the STRING
 * `"VENDOR_HIDDEN"`. So the field is a vocabulary the spec has not caught up with, and the contract
 * accepts both rather than believing the document over the server — the same posture as every other
 * vocabulary here, and the reason `FLEETPAL_PART_TYPES` exists is so a member we have not seen is
 * noticed by `lint:fleetpal-contract`'s reader rather than swallowed.
 */

export const fleetpalPartSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  /** Unique per company, compared case-insensitively. Renumbering is why F12 needs `fleetpal_id`. */
  number: z.string().nullable(),
  description: z.string(),
  /** Spec says integer, the server says `"VENDOR_HIDDEN"`. Both are accepted — see the header. */
  type: z.union([z.string(), z.number().int()]),
  /** Unique per company when set, so it works as a scan-to-match key — the same role our `upc` has. */
  universal_product_code: z.string(),
  component: z.string(),
  manufacturer: fleetpalId.nullable(),
  manufacturer_part_number: z.string(),
  /** One of 23 values against our 8. F12 owns the mapping, and an unmappable one stays unmapped. */
  unit_of_measure: z.string().nullable(),
  position_applicable: z.boolean(),
  serialized_part: z.boolean(),
  created: timestamp,
  updated: timestamp,
});
export type FleetpalPart = z.infer<typeof fleetpalPartSchema>;

// ── the people ──────────────────────────────────────────────────────────────────────────────────

/**
 * A supplier or a lender. `type` is `SERVICE` for parts and repair work, `FINANCIAL` for lenders
 * and lessors — and only the first kind can appear on a work order.
 *
 * `code` is the vendor's own short code, which their documentation offers as "the match key when
 * syncing from an accounting system". That is McLeod, and it is worth measuring at F4 whether it
 * is populated: a populated code would give the coverage bridge a second, stronger key than the
 * invoice number, which the vendor warns is not unique across suppliers.
 */
export const fleetpalVendorSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  name: z.string(),
  type: z.string(),
  code: z.string(),
  email: z.string(),
  website: z.string(),
  phone: z.string(),
  address: z.string(),
  address_2: z.string(),
  city: z.string(),
  state: z.string().nullable(),
  zip_code: z.string(),
  country: z.string().nullable(),
  payment_term: fleetpalId.nullable(),
  payment_method: z.string().nullable(),
  created: timestamp,
  updated: timestamp,
});
export type FleetpalVendor = z.infer<typeof fleetpalVendorSchema>;

/**
 * One of our own service locations. `code` prefixes the work-order and purchase-order numbers users
 * see, which is why `reference_number` and not `number` is what a human is holding.
 *
 * ⚠ **This resource has no `updated` field and no `updated_after` filter** — §2.7's bounded re-read
 * tier. It is also tiny, so the re-read is the whole collection and costs nothing. `created` exists;
 * `updated` does not, so a renamed shop is invisible to a watermark.
 */
export const fleetpalShopSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  name: z.string(),
  code: z.string().nullable(),
  contact: z.string(),
  email: z.string(),
  phone: z.string(),
  website: z.string(),
  address: z.string(),
  address_2: z.string(),
  city: z.string(),
  state: z.string().nullable(),
  zip_code: z.string(),
  country: z.string().nullable(),
  hourly_labor_rate: money.nullable(),
  created: timestamp,
});
export type FleetpalShop = z.infer<typeof fleetpalShopSchema>;

// ── the paperwork ───────────────────────────────────────────────────────────────────────────────

/**
 * A purchase order. `type` is `WORK_ORDER` for parts and services bought against a specific job —
 * and only then is `work_order` set, which is the first link of the coverage bridge.
 */
export const fleetpalPurchaseOrderSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  number: z.number().int(),
  reference_number: z.string(),
  type: z.string(),
  status: z.string(),
  shop: fleetpalId,
  vendor_location: fleetpalId,
  /**
   * ⚠ **Null on every purchase order on the live account** (measured F4, 2026-09-21), and the spec
   * agrees it is `nullable` — F1 typed it as required and would have rejected the first real page.
   * It is only set when the payee DIFFERS from the location that supplied the goods, so a fleet
   * that pays its suppliers directly leaves it null forever. §2.4's coverage bridge therefore
   * cannot join on it alone; F9 reads the vendor through `vendor_location` and treats `payable_to`
   * as the override it is.
   */
  payable_to: fleetpalId.nullable(),
  /** Set only when `type` is `WORK_ORDER`. The join from a repair to what it cost to buy. */
  work_order: fleetpalId.nullable(),
  description: z.string(),
  payment_method: z.string().nullable(),
  date_last_received: timestamp.nullable(),
  closed_on: timestamp.nullable(),
  canceled_on: timestamp.nullable(),
  cancellation_reason: z.string(),
  invoices_count: z.number().int(),
  total_invoices: money.nullable(),
  payments_count: z.number().int(),
  total_payments: money.nullable(),
  total_items: money.nullable(),
  created: timestamp,
  updated: timestamp,
});
export type FleetpalPurchaseOrder = z.infer<typeof fleetpalPurchaseOrderSchema>;

/**
 * A vendor's invoice against a purchase order — the second link of the coverage bridge.
 *
 * ⚠ **`number` is NOT unique across vendors.** The vendor's own documentation says to reconcile on
 * `payable_to` and this together, so the match key against `mcleod_ap_vouchers` is the PAIR
 * `(vendor, invoice_number)` and never the number alone. Matching on the number alone would join a
 * tyre shop's invoice 1001 to a parts supplier's invoice 1001 and inflate coverage.
 *
 * ⚠ **A `CREDIT` still carries a POSITIVE `amount`** — the type is what makes it a credit, not the
 * sign. Summing amounts without reading the type overstates spend by twice every credit note.
 */
export const fleetpalPoInvoiceSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  purchase_order: fleetpalId,
  /** STANDARD for an amount owed, CREDIT for one credited back. */
  type: z.string(),
  number: z.string(),
  date: timestamp,
  amount: money,
  /** Nullable, and null in practice — see the note on `PurchaseOrder.payable_to`. */
  payable_to: fleetpalId.nullable(),
  payment_term: fleetpalId.nullable(),
  created: timestamp,
  updated: timestamp,
});
export type FleetpalPoInvoice = z.infer<typeof fleetpalPoInvoiceSchema>;

/**
 * A delivery against a purchase order. **No `updated` field** — the bounded-re-read tier again, and
 * `created_after` is the filter that stands in for a watermark.
 */
export const fleetpalPoReceiptSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  purchase_order: fleetpalId,
  invoice: fleetpalId.nullable(),
  number: z.union([z.number().int(), z.string()]),
  discount: money.nullable(),
  sales_tax: money.nullable(),
  shipping_tax: money.nullable(),
  miscellaneous_tax: money.nullable(),
  total: money.nullable(),
  created: timestamp,
});
export type FleetpalPoReceipt = z.infer<typeof fleetpalPoReceiptSchema>;

/**
 * One line of a delivery — **the row that becomes a `received` movement on our shelf** (D-FP12,
 * F13). Q9 was ruled (a) by the owner on 2026-09-09: stock arriving is received in FleetPal and
 * ingested, because the alternative asks somebody to type every delivery twice and discovers the
 * divergence later as a variance nobody can explain.
 *
 * ⚠ **A `CANCEL` line is NOT a movement.** Both types reduce what is still on order, but only
 * `RECEIVE` means something physically arrived — and only `RECEIVE` lines count towards a receipt
 * total. Writing a movement for a cancellation would decrement a shelf that never gained the stock.
 *
 * ⚠ **`price` is what was actually INVOICED and may differ from the ordered price** on the
 * purchase-order item. It is the honest `unit_cost` for the movement, and using the ordered price
 * instead would value the shelf at what we expected to pay.
 *
 * A single ordered line can be received over several deliveries, so `quantity` is a part of what
 * was ordered and not necessarily all of it.
 */
export const fleetpalPoReceiptItemSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  receipt: fleetpalId,
  purchase_order_item: fleetpalId,
  type: z.string(),
  quantity: z.number(),
  price: money,
  total: money,
  created: timestamp,
});
export type FleetpalPoReceiptItem = z.infer<typeof fleetpalPoReceiptItemSchema>;
