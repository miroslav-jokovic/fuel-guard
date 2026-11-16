import type { SupabaseClient } from "@supabase/supabase-js";
import { fleetpalPoReceiptItemSchema, type FleetpalPoReceiptItem } from "@silvicom/shared";
import {
  getFleetpalShelf,
  partIdsByFleetpalId,
  recordFleetpalMovement,
  type FleetpalMovement,
} from "../../maintenance/index.js";
import { derivedUuid } from "../../../lib/derivedUuid.js";
import { FleetpalError } from "../errors.js";
import { advance, recordFailure } from "../syncState.js";
import type { IngestContext, IngestResult } from "./types.js";

/**
 * Receipts in, consumption out (FLEETPAL-INTEGRATION-PLAN.md F13; D-FP12, D-FP13, D-FP23–D-FP26).
 *
 * A delivery received in FleetPal (`/v1/purchase-order-receipt-items/`, type `RECEIVE`) becomes a
 * `received` movement; a part used on a FleetPal repair (`fleetpal_job_items`, type `PART`, already
 * staged by `jobItemsIngest`) becomes an `issued` one, carrying the work order's reference and the
 * truck or trailer F5 resolved. Both land on the ONE place an admin set to follow FleetPal, and only
 * from the instant they did (0621's `fleetpal_from`). With no such place, nothing moves.
 *
 * ── A WEEK RE-OFFERED EVERY HOUR, AND WHY THAT IS FREE ────────────────────────────────────────
 * There is no watermark. Every sweep offers every line from the last 7 days (never before the shelf's
 * start) to the ledger, whose movement id is derived from FleetPal's line id. A line already
 * recorded returns at the ledger's first step — the same idempotency the offline queue relies on
 * (D-INV27) — so a re-offer costs one indexed read. What it buys (D-FP25): a part used on a repair
 * before its delivery was received is refused as short (IV010, D-INV26 holds for FleetPal too), and
 * lands on a later sweep once the delivery has. Measured 2026-11-16: ~22 part lines and ~7 receipt
 * lines a day, so a week is a couple of hundred offers an hour. Past a week, a line the shelf still
 * cannot take is a counting problem, and a count fixes it.
 *
 * ⚠ The id's key includes the org. Two carriers sharing one FleetPal company is not a case today,
 * but a key without the org would make their movements collide on the ledger's primary key.
 *
 * ── RECEIPTS BEFORE CONSUMPTION ───────────────────────────────────────────────────────────────
 * Within one sweep every delivery is offered before any usage, so a part bought on a work-order
 * purchase order and fitted the same hour nets to zero instead of failing short first.
 *
 * ── WHAT IS NOT WRITTEN, AND IS COUNTED (D-FP26) ──────────────────────────────────────────────
 *   - a fractional quantity (gallons of oil): the shelf counts whole units;
 *   - a line whose part is not in our catalogue (FleetPal's numberless quote lines, which F12 skips);
 *   - a `CANCEL` receipt line: it reduces what is still on order, it never arrived (D-FP12).
 * The supplier stays null: `vendor_location` matched 0 of 4,416 purchase orders to a staged vendor
 * and FleetPal has no vendor-location endpoint, so the note names the purchase order instead.
 *
 * ── WHAT A LATER EDIT IN FLEETPAL DOES NOT DO ─────────────────────────────────────────────────
 * The ledger is append-only (IV011). A line FleetPal edits or deletes after it was recorded keeps
 * the movement it produced. That is the same as a person's movement: a correction is a count.
 */

export const SHELF_RESOURCE = "shelf";
const LOOKBACK_MS = 7 * 24 * 3600 * 1000;
const PAGE = 1000;

export interface ShelfTally {
  recorded: number;
  short: number;
  beforeStart: number;
  partInactive: number;
  fractional: number;
  notInCatalogue: number;
}

export interface ShelfResult extends IngestResult {
  tally: ShelfTally | null;
  /** Null when a place follows FleetPal; a sentence when none does, so the sweep's log says why nothing moved. */
  idle: string | null;
}

const emptyTally = (): ShelfTally => ({ recorded: 0, short: 0, beforeStart: 0, partInactive: 0, fractional: 0, notInCatalogue: 0 });

/**
 * Rows by FleetPal id, chunked at 100 — an `.in()` list rides in the URL. The caller names the table
 * in a literal `.from()`, so every table gate can still see which staged table this step reads.
 */
type ChunkRead = (chunk: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
async function byFleetpalId<T extends { fleetpal_id: string }>(ids: readonly string[], read: ChunkRead): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await read(unique.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as T[]) out.set(r.fleetpal_id, r);
  }
  return out;
}

/** A movement before our part id is known: FleetPal names its own part, and maintenance answers ours. */
type Pending = Omit<FleetpalMovement, "partId"> & { fleetpalPartId: string };

interface PoItemRow { fleetpal_id: string; part_fleetpal_id: string | null; purchase_order_fleetpal_id: string | null }
interface PoRow { fleetpal_id: string; reference_number: string | null; work_order_fleetpal_id: string | null }
interface JobItemRow {
  fleetpal_id: string;
  job_fleetpal_id: string | null;
  part_fleetpal_id: string | null;
  quantity: number | string | null;
  price: number | string | null;
  vendor_created_at: string;
}
interface JobRow { fleetpal_id: string; work_order_fleetpal_id: string | null }
interface WorkOrderRow { fleetpal_id: string; reference_number: string | null; unit_fleetpal_id: string | null }
interface UnitRow { fleetpal_id: string; vehicle_id: string | null; trailer_id: string | null }

/** A whole, positive quantity, or null — the shelf counts units (D-FP26). */
export function wholeQuantity(q: number | string | null): number | null {
  const n = q === null ? NaN : Number(q);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Cents, because `unit_cost` is numeric(12,2); a FleetPal price carries up to four places. */
const cents = (v: number | string | null): number | null => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

export const receiptMovementId = (orgId: string, itemId: string) => derivedUuid(`fleetpal:${orgId}:receipt-item:${itemId}`);
export const consumptionMovementId = (orgId: string, itemId: string) => derivedUuid(`fleetpal:${orgId}:job-item:${itemId}`);

async function receiptMovements(
  ctx: IngestContext,
  since: string,
  locationId: string,
  tally: ShelfTally,
): Promise<{ fetched: number; movements: Pending[] }> {
  const { admin, client, orgId } = ctx;
  const lines = (
    await client.walk("/v1/purchase-order-receipt-items/", fleetpalPoReceiptItemSchema, { created_after: since, type: "RECEIVE" })
  )
    // The filter is asked for AND re-checked: a vendor that ignores an unknown parameter would hand
    // back CANCEL lines, and one of those written as a receipt adds stock that never arrived.
    .filter((l: FleetpalPoReceiptItem) => l.type === "RECEIVE")
    .sort((a, b) => a.created.localeCompare(b.created));
  const poItems = await byFleetpalId<PoItemRow>(lines.map((l) => l.purchase_order_item), (c) =>
    admin.from("fleetpal_po_items").select("fleetpal_id, part_fleetpal_id, purchase_order_fleetpal_id").eq("org_id", orgId).in("fleetpal_id", c));
  const pos = await byFleetpalId<PoRow>([...poItems.values()].map((i) => i.purchase_order_fleetpal_id ?? ""), (c) =>
    admin.from("fleetpal_purchase_orders").select("fleetpal_id, reference_number, work_order_fleetpal_id").eq("org_id", orgId).in("fleetpal_id", c));
  const wos = await byFleetpalId<WorkOrderRow>([...pos.values()].map((p) => p.work_order_fleetpal_id ?? ""), (c) =>
    admin.from("fleetpal_work_orders").select("fleetpal_id, reference_number, unit_fleetpal_id").eq("org_id", orgId).in("fleetpal_id", c));

  const movements: Pending[] = [];
  for (const line of lines) {
    const quantity = wholeQuantity(line.quantity);
    if (quantity === null) { tally.fractional += 1; continue; }
    const item = poItems.get(line.purchase_order_item);
    // A purchase-order line not staged yet is offered again next hour, inside the same week; one with
    // no part is a fee or a tax line and never a shelf's business.
    if (!item?.part_fleetpal_id) { tally.notInCatalogue += 1; continue; }
    const po = item.purchase_order_fleetpal_id ? pos.get(item.purchase_order_fleetpal_id) : undefined;
    const wo = po?.work_order_fleetpal_id ? wos.get(po.work_order_fleetpal_id) : undefined;
    movements.push({
      id: receiptMovementId(orgId, line.id),
      fleetpalPartId: item.part_fleetpal_id,
      locationId,
      reason: "received",
      quantity,
      occurredAt: line.created,
      unitCost: cents(line.price),
      vehicleId: null,
      trailerId: null,
      workOrderRef: wo?.reference_number?.slice(0, 64) ?? null,
      note: po?.reference_number ? `Received in FleetPal on purchase order ${po.reference_number}.` : "Received in FleetPal.",
    });
  }
  return { fetched: lines.length, movements };
}

async function consumptionMovements(
  admin: SupabaseClient,
  orgId: string,
  since: string,
  locationId: string,
  tally: ShelfTally,
): Promise<{ fetched: number; movements: Pending[] }> {
  const items: JobItemRow[] = [];
  // Paged: PostgREST answers at most 1,000 rows whatever `.limit()` says.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fleetpal_job_items")
      .select("fleetpal_id, job_fleetpal_id, part_fleetpal_id, quantity, price, vendor_created_at")
      .eq("org_id", orgId)
      .eq("item_type", "PART")
      .gte("vendor_created_at", since)
      .order("vendor_created_at", { ascending: true })
      .order("fleetpal_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fleetpal_job_items: ${error.message}`);
    const page = (data ?? []) as JobItemRow[];
    items.push(...page);
    if (page.length < PAGE) break;
  }
  const jobs = await byFleetpalId<JobRow>(items.map((i) => i.job_fleetpal_id ?? ""), (c) =>
    admin.from("fleetpal_jobs").select("fleetpal_id, work_order_fleetpal_id").eq("org_id", orgId).in("fleetpal_id", c));
  const wos = await byFleetpalId<WorkOrderRow>([...jobs.values()].map((j) => j.work_order_fleetpal_id ?? ""), (c) =>
    admin.from("fleetpal_work_orders").select("fleetpal_id, reference_number, unit_fleetpal_id").eq("org_id", orgId).in("fleetpal_id", c));
  const units = await byFleetpalId<UnitRow>([...wos.values()].map((w) => w.unit_fleetpal_id ?? ""), (c) =>
    admin.from("fleetpal_units").select("fleetpal_id, vehicle_id, trailer_id").eq("org_id", orgId).in("fleetpal_id", c));

  const movements: Pending[] = [];
  for (const item of items) {
    const quantity = wholeQuantity(item.quantity);
    if (quantity === null) { tally.fractional += 1; continue; }
    if (!item.part_fleetpal_id) { tally.notInCatalogue += 1; continue; }
    const job = item.job_fleetpal_id ? jobs.get(item.job_fleetpal_id) : undefined;
    const wo = job?.work_order_fleetpal_id ? wos.get(job.work_order_fleetpal_id) : undefined;
    const unit = wo?.unit_fleetpal_id ? units.get(wo.unit_fleetpal_id) : undefined;
    // D-INV5: one unit or none. A FleetPal unit resolved to both is a mapping fault; name neither.
    const both = Boolean(unit?.vehicle_id && unit?.trailer_id);
    movements.push({
      id: consumptionMovementId(orgId, item.fleetpal_id),
      fleetpalPartId: item.part_fleetpal_id,
      locationId,
      reason: "issued",
      quantity,
      occurredAt: item.vendor_created_at,
      unitCost: cents(item.price),
      vehicleId: both ? null : unit?.vehicle_id ?? null,
      trailerId: both ? null : unit?.trailer_id ?? null,
      workOrderRef: wo?.reference_number?.slice(0, 64) ?? null,
      note: wo?.reference_number ? `Used on FleetPal work order ${wo.reference_number}.` : "Used on a FleetPal repair.",
    });
  }
  return { fetched: items.length, movements };
}

export async function ingestShelf(ctx: IngestContext, now: () => Date = () => new Date()): Promise<ShelfResult> {
  const { admin, orgId } = ctx;
  const result = (patch: Partial<ShelfResult>): ShelfResult => ({
    resource: SHELF_RESOURCE, fetched: 0, staged: 0, advancedTo: null, error: null, tally: null, idle: null, ...patch,
  });
  const fail = async (message: string, patch: Partial<ShelfResult> = {}): Promise<ShelfResult> => {
    await recordFailure(admin, orgId, SHELF_RESOURCE, message);
    return result({ ...patch, error: message });
  };

  const shelf = await getFleetpalShelf(admin, orgId);
  if (shelf && "error" in shelf) return fail(shelf.error);
  if (!shelf) return result({ idle: "No shop place follows FleetPal, so no shelf moves." });

  const runAt = now();
  const weekAgo = new Date(runAt.getTime() - LOOKBACK_MS).toISOString();
  const since = shelf.from > weekAgo ? shelf.from : weekAgo;
  const tally = emptyTally();

  try {
    const receipts = await receiptMovements(ctx, since, shelf.locationId, tally);
    const consumption = await consumptionMovements(admin, orgId, since, shelf.locationId, tally);
    const all = [...receipts.movements, ...consumption.movements];
    const parts = await partIdsByFleetpalId(admin, orgId, all.map((m) => m.fleetpalPartId));
    if ("error" in parts) return fail(parts.error, { tally });

    for (const { fleetpalPartId, ...m } of all) {
      const partId = parts.get(fleetpalPartId);
      if (!partId) { tally.notInCatalogue += 1; continue; }
      const outcome = await recordFleetpalMovement(admin, orgId, { ...m, partId });
      if ("error" in outcome) return fail(outcome.error, { tally, fetched: receipts.fetched + consumption.fetched });
      if (outcome.outcome === "recorded") tally.recorded += 1;
      else if (outcome.outcome === "short") tally.short += 1;
      else if (outcome.outcome === "before_start") tally.beforeStart += 1;
      else tally.partInactive += 1;
    }

    const fetched = receipts.fetched + consumption.fetched;
    // `recorded` counts replays too — the ledger returns the row it already has — so it reads as
    // "lines the shelf holds", not "lines new this hour".
    const moved = await advance(admin, orgId, SHELF_RESOURCE, { kind: "window", to: runAt.toISOString() }, tally.recorded);
    if ("error" in moved) return result({ fetched, staged: tally.recorded, tally, error: moved.error });
    return result({ fetched, staged: tally.recorded, advancedTo: runAt.toISOString(), tally });
  } catch (e) {
    return fail(e instanceof FleetpalError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : String(e), { tally });
  }
}
