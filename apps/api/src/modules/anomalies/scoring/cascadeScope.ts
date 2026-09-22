/**
 * WHERE the post-import cascade starts, per vehicle (DATA-LIFECYCLE-PLAN Q6, fix (a) first half; Q6e
 * ruled (c) 2026-09-22). Split from backfill.ts, which sits at 457 of its 500-line budget.
 *
 * ── WHY A FLOOR, AND WHY THIS ONE ───────────────────────────────────────────────────────────────
 * `scoreImportWithCascade` used to re-score EVERY fill of every vehicle an import touched, oldest
 * first — ~5,640 fills for a ~58-vehicle import, 61% of all scoring attempts landing on fills older
 * than 120 days (measured 2026-09-22 19:30 UTC, after Q6a closed). But an imported fill N can only
 * move the verdict of a fill X through three reads, and two of them are bounded in time:
 *
 *  (i)  X's predecessors (`consumptionContext.ts`) — N is one only if N is EARLIER than X in
 *       business time. Business time is `samsara_recon_at` for a matched fill (`rowEventTime`).
 *  (ii) X's cumulative window — `anchor ± cumulative_window_hours` (`scoreTransaction.ts`), two-sided,
 *       so N can move fills up to W hours BEFORE it.
 *  (iii) the vehicle's CURRENT learned gates (`context.ts`) — vehicle-wide, not time-bounded. Q6e
 *       ruled that drift here is accepted, as the live path (`scoreWithCascade`, 5 fills forward) has
 *       always accepted it; a full re-sync is an explicit rebuild, not a side effect of an import.
 *
 * So nothing whose `fueled_at` is earlier than `min(N.fueled_at) − W − 2·drift` can change, where
 * drift is how far business time can sit from `fueled_at` on either fill. Everything from the floor
 * forward is still re-scored — the forward half has no fixed horizon (a changed verdict feeds the
 * next fill's predecessor read) and bounding it is the second half of fix (a), which waits on the
 * `verdict_hash` measurement.
 *
 * ⚠ DRIFT IS MEASURED, NOT DERIVED — nothing in the code bounds it. Over the 16,205 fills whose
 * business time is `samsara_recon_at` (2026-09-22), |samsara_recon_at − fueled_at| peaked at 18.0 h,
 * 0 over 24 h. 24 h per side is that measurement with headroom; if a new time source can move a fill
 * further than that, this constant is the thing to revisit, and a fill outside it would be left
 * un-cascaded (stale until a rebuild), not corrupted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CASCADE_TIME_DRIFT_HOURS = 24;

/** The earliest `fueled_at` the cascade must re-score, given the import's earliest fill for a vehicle. */
export function cascadeFloorIso(earliestImportedIso: string, cumulativeWindowHours: number): string {
  const marginMs = (cumulativeWindowHours + 2 * CASCADE_TIME_DRIFT_HOURS) * 3_600_000;
  return new Date(Date.parse(earliestImportedIso) - marginMs).toISOString();
}

/**
 * Each vehicle the import attributed fills to → the EARLIEST `fueled_at` among them.
 *
 * ⚠ PAGED. PostgREST caps every response at 1,000 rows and one production import held 2,151 fills;
 * the unpaged read this replaces could silently drop vehicles from the cascade, and with a floor a
 * truncated read is worse — it yields a floor that is too LATE, skipping fills that can change.
 */
export async function importVehicleEarliest(
  admin: SupabaseClient,
  orgId: string,
  importId: string,
): Promise<Map<string, string>> {
  const PAGE = 1000;
  const earliest = new Map<string, string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("fuel_transactions")
      .select("id, vehicle_id, fueled_at")
      .eq("org_id", orgId)
      .eq("import_id", importId)
      .not("vehicle_id", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`[scoring] could not read import ${importId} vehicles: ${error.message}`);
    const rows = (data ?? []) as { vehicle_id: string | null; fueled_at: string }[];
    for (const r of rows) {
      if (!r.vehicle_id) continue;
      const cur = earliest.get(r.vehicle_id);
      if (cur === undefined || Date.parse(r.fueled_at) < Date.parse(cur)) earliest.set(r.vehicle_id, r.fueled_at);
    }
    if (rows.length < PAGE) break;
  }
  return earliest;
}
