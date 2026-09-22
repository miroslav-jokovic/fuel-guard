import {
  fleetpalPoInvoiceSchema,
  fleetpalPurchaseOrderSchema,
  type FleetpalPoInvoice,
  type FleetpalPurchaseOrder,
} from "@silvicom/shared";
import type { ResourceIngest } from "./types.js";

/**
 * The invoice bridge's own two collections (FLEETPAL-INTEGRATION-PLAN.md F9, §2.4).
 *
 * ── WHY THIS FILE EXISTS AT ALL, WHEN THE PLAN SAID F9 NEEDED NO MIGRATION ────────────────────
 * Because the plan's own step list never staged these. F6 took the repair record, F7 the condition
 * tier, F12 takes the parts catalogue, and F13 reads receipt ITEMS straight into `recordMovement`
 * without staging them. Purchase orders and their invoices — the two resources §2.4's coverage
 * bridge is entirely made of — belonged to no step. D-FP4 forbids printing FleetPal money without
 * the ratio beside it, so the gap was not "F9 is missing a nice-to-have": it was F9 being
 * unbuildable as specified. Migration 0351 and this file are that half, and the plan's §5 now says
 * so rather than carrying a step that cannot be done.
 *
 * ── BOTH WATERMARK, WHICH MAKES THIS THE PLAIN CASE ───────────────────────────────────────────
 * Unlike F7's three siblings, these two are the easy tier: `PurchaseOrder` and `POInvoice` both
 * carry `updated` and both endpoints take `updated_after` (§2.7's filter matrix), so both go
 * through `runIngest` with no bespoke walk. The receipts beneath them do NOT — `created_after` is
 * all they offer — which is one more reason F13 reads them rather than staging them here.
 *
 * ── ⚠ WHAT IS DELIBERATELY NOT MAPPED ─────────────────────────────────────────────────────────
 * Nothing collapses `payable_to` into `vendor_location` on the way in. They are two different facts
 * — "the payee was recorded and differs from the supplier" versus "the payee was never recorded" —
 * and 81.5% of the live account is the second (F4, 2026-09-21). The coalesce that turns the pair
 * into one vendor of record happens at READ, where it can be seen; doing it here would store an
 * interpretation and lose the input to it.
 *
 * Likewise a `CREDIT` invoice is mapped with its POSITIVE `amount` intact and its type beside it.
 * The vendor's model makes the type the sign, and a signed column computed here would quietly
 * absorb a third type nobody has seen yet.
 */

export const purchaseOrdersIngest: ResourceIngest<FleetpalPurchaseOrder> = {
  resource: "purchase-orders",
  path: "/v1/purchase-orders/",
  rpc: "stage_fleetpal_purchase_orders",
  schema: fleetpalPurchaseOrderSchema,
  updatedOf: (row) => row.updated,
  map: (row) => ({
    fleetpal_id: row.id,
    number: row.number,
    reference_number: row.reference_number,
    // `type` on the wire; `po_type` in the column, because `type` is not a name a staging table can
    // carry without every later query quoting it.
    po_type: row.type,
    status: row.status,
    shop_fleetpal_id: row.shop,
    vendor_location_fleetpal_id: row.vendor_location,
    payable_to_fleetpal_id: row.payable_to,
    // Set only when `type` is WORK_ORDER — 2,899 of 3,969 rows on the live account (F4). This is
    // the column that ties a dollar to a repair and through the repair to a truck.
    work_order_fleetpal_id: row.work_order,
    description: row.description,
    payment_method: row.payment_method,
    date_last_received: row.date_last_received,
    closed_on: row.closed_on,
    canceled_on: row.canceled_on,
    cancellation_reason: row.cancellation_reason,
    invoices_count: row.invoices_count,
    total_invoices: row.total_invoices,
    payments_count: row.payments_count,
    total_payments: row.total_payments,
    total_items: row.total_items,
    vendor_created_at: row.created,
    vendor_updated_at: row.updated,
  }),
};

/**
 * The vendor's invoice against a purchase order — the numerator of the D-FP4 ratio.
 *
 * ⚠ **`number` is the only key this bridge has into `mcleod_ap_vouchers`, and it is not unique
 * across vendors.** FleetPal's documentation says to reconcile on `(payable_to, number)`; measured
 * at F4, `payable_to` is null on 81.5% of invoices and `Vendor.code` — the field the vendor itself
 * offers as the accounting-system match key — is populated on 1 of 761 vendors, so the McLeod side
 * has no exact key to meet it. Q9 was ruled (a) by the owner on 2026-09-21: join on the number
 * alone and report the result as a bound. The mapping's job is to keep the number exactly as the
 * vendor entered it — no trimming, no case folding, no zero-stripping — because every one of those
 * would be a normalisation nobody could later tell from a real match.
 */
export const poInvoicesIngest: ResourceIngest<FleetpalPoInvoice> = {
  resource: "purchase-order-invoices",
  path: "/v1/purchase-order-invoices/",
  rpc: "stage_fleetpal_po_invoices",
  schema: fleetpalPoInvoiceSchema,
  updatedOf: (row) => row.updated,
  map: (row) => ({
    fleetpal_id: row.id,
    purchase_order_fleetpal_id: row.purchase_order,
    // STANDARD or CREDIT. Stored beside an amount that is positive either way — see the header.
    invoice_type: row.type,
    invoice_number: row.number,
    invoice_date: row.date,
    amount: row.amount,
    payable_to_fleetpal_id: row.payable_to,
    payment_term_fleetpal_id: row.payment_term,
    vendor_created_at: row.created,
    vendor_updated_at: row.updated,
  }),
};
