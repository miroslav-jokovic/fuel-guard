import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTRIBUTION_ENGINE_VERSION, type AttributionOutcome } from "@silvicom/shared";
import type { SamsaraRawFetcher } from "../../samsara/index.js";
import { attributeInspection, type InspectionToAttribute } from "./attribute.js";

/**
 * The attribution backlog, worked a batch at a time from the FMCSA feed's hourly tick
 * (INSPECTION-CHALLENGE-PLAN IC5 and §4.1's "backfill every inspection Samsara can still answer for").
 *
 * ── NEWEST FIRST, A BATCH PER TICK ─────────────────────────────────────────────────────────────
 * Every current inspection without an engine reading at `ATTRIBUTION_ENGINE_VERSION` is due — a new
 * one the day it appears, the three-year record a batch at a time (1,391 on 2026-10-14 at 25 an hour
 * is about two and a half days). Newest first, because a new inspection is the one somebody is about
 * to ask about. A version bump re-reads every inspection, the old rows kept beside the new (D-IC5).
 *
 * ── NOT BEFORE ITS UNITS ARRIVE ────────────────────────────────────────────────────────────────
 * FMCSA's unit file lags its inspection file by a day (measured 2026-10-11). An inspection with no
 * projected unit is skipped, not recorded as "no matched tractor": that would be a reading of a gap
 * in the feed, and the engine row is written once per version.
 */
export const ATTRIBUTIONS_PER_TICK = 25;

const PAGE = 1000;

/** Every row of a paged read (PostgREST caps a response at 1,000). */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function attributeBacklog(
  admin: SupabaseClient,
  orgId: string,
  fetchRaw: SamsaraRawFetcher,
  nowMs: number,
  limit = ATTRIBUTIONS_PER_TICK,
): Promise<Partial<Record<AttributionOutcome, number>>> {
  const done = new Set(
    (
      await allRows<{ inspection_id: string }>((a, b) =>
        admin
          .from("inspection_attributions")
          .select("inspection_id")
          .eq("org_id", orgId)
          .eq("source", "engine")
          .eq("engine_version", ATTRIBUTION_ENGINE_VERSION)
          .order("inspection_id")
          .range(a, b),
      )
    ).map((r) => r.inspection_id),
  );
  const current = await allRows<{ id: string; inspection_date: string; start_hhmm: string | null; end_hhmm: string | null; report_state: string | null }>((a, b) =>
    admin
      .from("roadside_inspections")
      .select("id, inspection_date, start_hhmm, end_hhmm, report_state")
      .eq("org_id", orgId)
      .is("vanished_at", null)
      .not("inspection_date", "is", null)
      .order("inspection_date", { ascending: false })
      .order("id")
      .range(a, b),
  );
  const due = current.filter((i) => !done.has(i.id)).slice(0, limit);
  if (due.length === 0) return {};

  const units = await admin
    .from("roadside_inspection_units")
    .select("inspection_id, unit_seq, vehicle_id")
    .eq("org_id", orgId)
    .in("inspection_id", due.map((i) => i.id))
    .is("vanished_at", null);
  if (units.error) throw new Error(units.error.message);
  const unitRows = (units.data ?? []) as { inspection_id: string; unit_seq: number | null; vehicle_id: string | null }[];
  const vehicleIds = [...new Set(unitRows.map((u) => u.vehicle_id).filter((v): v is string => v !== null))];
  const samsaraOf = new Map<string, string | null>();
  if (vehicleIds.length > 0) {
    const v = await admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).in("id", vehicleIds);
    if (v.error) throw new Error(v.error.message);
    for (const r of (v.data ?? []) as { id: string; samsara_vehicle_id: string | null }[]) samsaraOf.set(r.id, r.samsara_vehicle_id);
  }

  const tally: Partial<Record<AttributionOutcome, number>> = {};
  for (const i of due) {
    const mine = unitRows.filter((u) => u.inspection_id === i.id);
    if (mine.length === 0) continue;
    // The power unit is the report's unit 1 (0458): the tractor the driver was in.
    const vehicleId = mine.find((u) => u.unit_seq === 1)?.vehicle_id ?? null;
    const insp: InspectionToAttribute = {
      id: i.id,
      date: i.inspection_date,
      startHhmm: i.start_hhmm,
      endHhmm: i.end_hhmm,
      reportState: i.report_state,
      vehicleId,
      samsaraVehicleId: vehicleId ? (samsaraOf.get(vehicleId) ?? null) : null,
    };
    // One inspection's failure (a storage or database error; Samsara's refusals are frozen, not thrown)
    // must not hold the batch behind it, and newest-first would otherwise put it in front every tick.
    try {
      const outcome = await attributeInspection(admin, orgId, insp, fetchRaw, nowMs);
      tally[outcome] = (tally[outcome] ?? 0) + 1;
    } catch (e) {
      console.error(`[inspection-attribution] org ${orgId} inspection ${i.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return tally;
}
