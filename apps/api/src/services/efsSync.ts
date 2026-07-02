import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveFuelEventsFromEfsStore,
  reconcileFuelLines,
  type EfsStoreLine,
  type ParsedFuelLine,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { scoreTransaction } from "./scoring.js";

/**
 * Self-heal fuel_transactions from the faithful EFS store (docs: DATA-RELIABILITY-CHANGES.md).
 *
 * efs_transactions holds every uploaded line verbatim — the system of record. This routine re-derives
 * the merged fuel events from it and reconciles them against fuel_transactions:
 *   • event missing entirely (half-failed import, historical merge-bug drop) → INSERT
 *   • event present but with a wrong fueling time (the pre-0026 scorer rewrote fueled_at and the
 *     migration could not restore every row) or wrong gallons/cost (invoice-reuse merge bug summed
 *     two days into one) → UPDATE to the store-derived truth
 * Everything else is untouched. Newly inserted/repaired rows are re-scored.
 *
 * Known limitations (counted in the result, never silently ignored):
 *   • blank-invoice lines can't be re-keyed deterministically → skipped
 *   • fuel lines whose product code is numeric (classified via ProductDescription at import time,
 *     which the store does not persist) → counted under skippedNonFuel
 */
export interface EfsSyncResult {
  storeLines: number;
  derivedEvents: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skippedNonFuel: number;
  skippedBlankInvoice: number;
  skippedUnusable: number;
  /** Rows the repair touched — the caller re-scores these (in the background; Samsara-rate-limited). */
  touchedIds: string[];
}

const PAGE = 1000;

const n = (v: unknown): number | null => (v == null ? null : Number(v));

async function loadAllEfsLines(admin: SupabaseClient, orgId: string): Promise<EfsStoreLine[]> {
  const out: EfsStoreLine[] = [];
  for (let fromRow = 0; ; fromRow += PAGE) {
    const { data, error } = await admin
      .from("efs_transactions")
      .select("card_num, invoice, tran_date, fueled_at, unit, driver_name, odometer, location_name, city, state, item, qty, amt")
      .eq("org_id", orgId)
      .order("tran_date", { ascending: true })
      .order("line_number", { ascending: true })
      .range(fromRow, fromRow + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const r of rows) {
      out.push({
        card_num: (r.card_num as string) ?? null,
        invoice: (r.invoice as string) ?? null,
        tran_date: (r.tran_date as string) ?? null,
        fueled_at: (r.fueled_at as string) ?? null,
        unit: (r.unit as string) ?? null,
        driver_name: (r.driver_name as string) ?? null,
        odometer: n(r.odometer),
        location_name: (r.location_name as string) ?? null,
        city: (r.city as string) ?? null,
        state: (r.state as string) ?? null,
        item: (r.item as string) ?? null,
        qty: n(r.qty),
        amt: n(r.amt),
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

interface ExistingFuelRow {
  id: string;
  external_ref: string;
  fueled_at: string;
  fueled_at_precision: string | null;
  gallons: number | string;
  total_cost: number | string | null;
  vehicle_id: string | null;
  driver_id: string | null;
}

async function loadExistingByRef(admin: SupabaseClient, orgId: string): Promise<Map<string, ExistingFuelRow>> {
  const out = new Map<string, ExistingFuelRow>();
  for (let fromRow = 0; ; fromRow += PAGE) {
    const { data, error } = await admin
      .from("fuel_transactions")
      .select("id, external_ref, fueled_at, fueled_at_precision, gallons, total_cost, vehicle_id, driver_id")
      .eq("org_id", orgId)
      .eq("source", "fuel_card")
      .not("external_ref", "is", null)
      .order("id", { ascending: true })
      .range(fromRow, fromRow + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as ExistingFuelRow[];
    for (const r of rows) out.set(r.external_ref, r);
    if (rows.length < PAGE) break;
  }
  return out;
}

const loc = (...parts: (string | null)[]) => parts.filter(Boolean).join(", ") || null;

export async function syncFuelEventsFromEfs(
  admin: SupabaseClient,
  orgId: string,
  actorId: string | null,
): Promise<EfsSyncResult> {
  const lines = await loadAllEfsLines(admin, orgId);
  const derived = deriveFuelEventsFromEfsStore(lines);

  const [{ data: vehicles }, { data: drivers }] = await Promise.all([
    admin.from("vehicles").select("id, unit_number").eq("org_id", orgId),
    admin.from("drivers").select("id, full_name").eq("org_id", orgId),
  ]);
  const reconciled = reconcileFuelLines(
    derived.events,
    (vehicles ?? []) as { id: string; unit_number: string }[],
    (drivers ?? []) as { id: string; full_name: string }[],
  );

  const existing = await loadExistingByRef(admin, orgId);

  const toInsert: (ParsedFuelLine & { vehicle_id: string | null; driver_id: string | null })[] = [];
  const toUpdate: { id: string; patch: Record<string, unknown> }[] = [];
  let unchanged = 0;

  for (const ev of reconciled) {
    const cur = existing.get(ev.external_ref);
    if (!cur) {
      toInsert.push(ev);
      continue;
    }
    const patch: Record<string, unknown> = {};
    // Time: the store-derived instant is the truth (business time; noon sentinel for date-only rows).
    if (new Date(cur.fueled_at).getTime() !== new Date(ev.fueled_at).getTime()) {
      patch.fueled_at = ev.fueled_at;
      patch.fueled_at_precision = ev.fueled_at_precision;
    }
    // Quantity/cost: repairs events inflated by the historical cross-day invoice merge.
    if (Math.abs(Number(cur.gallons) - ev.gallons) > 0.001) patch.gallons = ev.gallons;
    const curCost = cur.total_cost == null ? null : Number(cur.total_cost);
    if (Math.abs((curCost ?? 0) - (ev.total_cost ?? 0)) > 0.005) {
      patch.total_cost = ev.total_cost;
      patch.price_per_gal = ev.price_per_gal;
    }
    // Attribution: only ever FILL a missing link, never overwrite an existing one.
    if (cur.vehicle_id == null && ev.vehicle_id != null) patch.vehicle_id = ev.vehicle_id;
    if (cur.driver_id == null && ev.driver_id != null) patch.driver_id = ev.driver_id;

    if (Object.keys(patch).length === 0) unchanged += 1;
    else toUpdate.push({ id: cur.id, patch });
  }

  // Record the repair as an import (source 'efs_feed') so inserted rows carry provenance.
  let importId: string | null = null;
  if (toInsert.length) {
    const { data: imp, error } = await admin
      .from("imports")
      .insert({
        org_id: orgId,
        source: "efs_feed",
        kind: "transaction",
        filename: "repair: derived from stored EFS lines",
        status: "completed",
        total_rows: derived.events.length,
        inserted_rows: toInsert.length,
        duplicate_rows: unchanged,
        skipped_rows: derived.skippedNonFuel + derived.skippedBlankInvoice + derived.skippedUnusable,
        created_by: actorId,
      })
      .select("id")
      .single();
    if (error || !imp) throw new Error(error?.message ?? "could not create repair import record");
    importId = (imp as { id: string }).id;

    const rows = toInsert.map((ev) => ({
      org_id: orgId,
      vehicle_id: ev.vehicle_id,
      driver_id: ev.driver_id,
      fueled_at: ev.fueled_at,
      fueled_at_precision: ev.fueled_at_precision,
      odometer: ev.odometer,
      gallons: ev.gallons,
      total_cost: ev.total_cost,
      price_per_gal: ev.price_per_gal,
      location_text: loc(ev.location_text, ev.city, ev.state),
      city: ev.city,
      state: ev.state,
      card_ref: ev.card_ref,
      source: "fuel_card",
      external_ref: ev.external_ref,
      import_id: importId,
      entered_by: actorId,
    }));
    const { error: insErr } = await admin
      .from("fuel_transactions")
      .upsert(rows, { onConflict: "org_id,external_ref", ignoreDuplicates: true });
    if (insErr) throw new Error(insErr.message);
  }

  for (const u of toUpdate) {
    const { error } = await admin.from("fuel_transactions").update(u.patch).eq("id", u.id).eq("org_id", orgId);
    if (error) throw new Error(error.message);
  }

  // Everything the repair touched needs re-scoring (fresh Samsara reconciliation) — collected here,
  // executed by the caller in the background so the HTTP request isn't held open for minutes.
  const touchedIds: string[] = toUpdate.map((u) => u.id);
  if (importId) {
    const { data: ins } = await admin.from("fuel_transactions").select("id").eq("import_id", importId);
    for (const r of (ins ?? []) as { id: string }[]) touchedIds.push(r.id);
  }

  return {
    storeLines: lines.length,
    derivedEvents: derived.events.length,
    inserted: toInsert.length,
    updated: toUpdate.length,
    unchanged,
    skippedNonFuel: derived.skippedNonFuel,
    skippedBlankInvoice: derived.skippedBlankInvoice,
    skippedUnusable: derived.skippedUnusable,
    touchedIds,
  };
}

/** Sequentially re-score repaired rows (live Samsara recon — rate-limited, run in the background). */
export async function scoreTouched(admin: SupabaseClient, env: Env, orgId: string, ids: string[]): Promise<number> {
  let scored = 0;
  for (const id of ids) {
    try {
      await scoreTransaction(admin, env, orgId, id);
      scored += 1;
    } catch (e) {
      console.error(`[efs-sync] scoring ${id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return scored;
}
