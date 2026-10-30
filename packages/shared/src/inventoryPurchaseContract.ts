import { z } from "zod";
import { recordId } from "./recordId.js";
import { documentRegisterSchema } from "./complianceContract.js";

/**
 * Equipment bills — `/api/maintenance/inventory/purchases` (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md
 * §7a.4, M10b; the table is 0530's `equipment_purchases`). Truck inventory only: a shop part's bill is
 * FleetPal's (M8), and a FleetPal-bought strap is linked to FleetPal's purchase order, never retyped.
 *
 * Its own file because `inventoryContract.ts` and `inventoryAssetContract.ts` sit at the 500-line
 * budget (DE2a's note), and a bill is a third thing beside a shelf and an item.
 *
 * ── THE ID IS THE CALLER'S (D-INV27) ──────────────────────────────────────────────────────────
 * The drawer mints it once per opening and reuses it on every retry, so a save that timed out and is
 * pressed again records one bill, not two; the paper is then filed against that same id. A hook that
 * minted one per attempt would break this without a test noticing — `useAssets.ts` says the same of
 * a movement's.
 *
 * ── A CORRECTION IS A NEW BILL ────────────────────────────────────────────────────────────────
 * `supersedes` names the live bill it replaces; 0530 marks the old one and moves its items. The list
 * of items is always the WHOLE set the bill paid for — an item the correction leaves out is cleared —
 * so a form that sent only the changes would silently empty a bill.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD");
/** The bill's total as printed: cents, never more (0530's numeric(12,2)). */
const money = z
  .number()
  .nonnegative()
  .max(9_999_999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Use dollars and cents");

/** A bill holds at most this many items — a box of tablets is ten; 200 is a pallet. */
export const PURCHASE_ITEMS_MAX = 200;

export const equipmentPurchaseInputSchema = z.object({
  id: recordId(),
  vendor: z.string().trim().min(1, "Who sent the bill?").max(120),
  invoiceNumber: z.string().trim().min(1, "The number printed on the bill").max(64),
  invoiceDate: date,
  total: money,
  notes: z.string().trim().max(2000).nullable().optional(),
  fleetpalPurchaseOrderId: recordId().nullable().optional(),
  supersedes: recordId().nullable().optional(),
  assetIds: z.array(recordId()).max(PURCHASE_ITEMS_MAX),
});
export type EquipmentPurchaseInput = z.infer<typeof equipmentPurchaseInputSchema>;

/** FleetPal's purchase order as a bill names it: what a person holding the paper recognises. */
export const fleetpalOrderRefSchema = z.object({
  id: recordId(),
  referenceNumber: z.string().nullable(),
  description: z.string().nullable(),
  /** FleetPal's own total; null when FleetPal sent none (a dash, never $0 — D-FIN10). */
  total: z.number().nullable(),
  createdAt: z.string().nullable(),
});
export type FleetpalOrderRef = z.infer<typeof fleetpalOrderRefSchema>;

export const equipmentPurchaseDtoSchema = z.object({
  id: recordId(),
  vendor: z.string(),
  invoiceNumber: z.string(),
  invoiceDate: date,
  total: z.number(),
  notes: z.string().nullable(),
  fleetpalOrder: fleetpalOrderRefSchema.nullable(),
  itemCount: z.number().int().nonnegative(),
  paperCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  /** Set once somebody corrected this bill; the newest one is live. */
  supersededBy: recordId().nullable(),
});
export type EquipmentPurchaseDto = z.infer<typeof equipmentPurchaseDtoSchema>;

/** One item a bill paid for, as the bill lists it. */
export const purchaseItemSchema = z.object({
  id: recordId(),
  displayNo: z.string(),
  name: z.string(),
  assetTypeName: z.string(),
  purchaseCost: z.number().nullable(),
});
export type PurchaseItem = z.infer<typeof purchaseItemSchema>;

export const equipmentPurchaseDetailSchema = equipmentPurchaseDtoSchema.extend({
  items: z.array(purchaseItemSchema),
});
export type EquipmentPurchaseDetail = z.infer<typeof equipmentPurchaseDetailSchema>;

/** The line an item's page shows (M10b): which bill paid for it. */
export const assetPurchaseRefSchema = z.object({
  id: recordId(),
  vendor: z.string(),
  invoiceNumber: z.string(),
  invoiceDate: date,
});
export type AssetPurchaseRef = z.infer<typeof assetPurchaseRefSchema>;

/**
 * `POST /purchases/:id/documents` — the bill's paper. The register's own fields, derived rather than
 * restated: the subject comes from the path, the kind is always `equipment_invoice` (0530), a file is
 * page 1 of an original. `roadsideDocumentRegisterSchema` is the precedent.
 */
export const purchaseDocumentRegisterSchema = documentRegisterSchema.omit({
  subjectType: true,
  subjectId: true,
  kind: true,
  page: true,
  variant: true,
});
export type PurchaseDocumentRegisterRequest = z.infer<typeof purchaseDocumentRegisterSchema>;
