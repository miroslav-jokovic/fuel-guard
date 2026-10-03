/**
 * D-IE9's gate, read (IE5): does the idle engine agree with the trucks' own computers on enough
 * truck-days to replace today's idle figures? The verdict is `idleParityReport`'s (packages/shared);
 * this file only reads its two sides and the one fact that says which days are final.
 *
 *  - ours      `idle_engine_days` (0404): running = driving + stopped running + brief stops; the ECU's
 *              engine-seconds delta and how many hours had one.
 *  - Samsara   `vehicle_engine_days`: its idle seconds for the same truck and the same local day —
 *              both tables are bucketed on the org's operating timezone (`fuelPriceDaySync.ts`), so a
 *              row pairs with a row. Shown for information only (Q-IE17), and only when its coverage
 *              spans the whole day (`idleParityDays`).
 *  - final     the latest FINISHED nightly run's window start (`jobs.stats.from`): the first day of that
 *              window has had its last write, and every day before it too.
 *
 * The platform console reads the same gate with its own queries (`apps/admin-api/src/lib/idleEngine.ts`,
 * IE-ADMIN); the columns, the row-to-day mapping and the view shape are shared so the two cannot drift.
 *
 * Nothing switches here. The page and the driver scores move to the engine in a later merge, once
 * this says `pass` (§4 Q-IE16) — until then this is the list a person reads to see whether to trust it.
 *
 * ORG-FILTERED explicitly: the service role bypasses RLS, so every `.eq("org_id")` IS the tenant boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IDLE_ENGINE_DAY_COLUMNS,
  SAMSARA_ENGINE_DAY_COLUMNS,
  fetchAllPaged,
  idleEngineParityView,
  idleParityDays,
  idleParityFinalThrough,
  idleParityReport,
  organizationTimezone,
  type IdleEngineDayRow,
  type IdleEngineParityView,
  type SamsaraEngineDayRow,
} from "@silvicom/shared";

/** The latest finished nightly's window start, or null when none has finished yet. */
async function latestNightlyFrom(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("jobs")
    .select("stats")
    .eq("org_id", orgId)
    .eq("kind", "idle_engine")
    .eq("status", "done")
    .eq("stats->>mode", "nightly")
    .order("finished_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`idle engine parity: nightly read: ${error.message}`);
  const from = (data?.[0]?.stats as { from?: unknown } | undefined)?.from;
  return typeof from === "string" ? from : null;
}

export async function readIdleEngineParity(admin: SupabaseClient, orgId: string): Promise<IdleEngineParityView> {
  const [{ data: org }, nightlyFrom] = await Promise.all([
    admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle(),
    latestNightlyFrom(admin, orgId),
  ]);
  const timezone = organizationTimezone(org?.operating_hours);
  const finalThrough = idleParityFinalThrough(nightlyFrom, timezone);
  const empty = idleEngineParityView(idleParityReport([], finalThrough), timezone, new Map());
  if (finalThrough == null) return empty;

  const ours = await fetchAllPaged<IdleEngineDayRow>((a, b) =>
    admin
      .from("idle_engine_days")
      .select(IDLE_ENGINE_DAY_COLUMNS)
      .eq("org_id", orgId)
      .lte("day", finalThrough)
      .order("day")
      .order("vehicle_id")
      .range(a, b),
  );
  if (ours.length === 0) return empty;
  const firstDay = ours[0]!.day;
  const [theirs, vehicles] = await Promise.all([
    fetchAllPaged<SamsaraEngineDayRow>((a, b) =>
      admin
        .from("vehicle_engine_days")
        .select(SAMSARA_ENGINE_DAY_COLUMNS)
        .eq("org_id", orgId)
        .gte("day", firstDay)
        .lte("day", finalThrough)
        .order("day")
        .order("vehicle_id")
        .range(a, b),
    ),
    fetchAllPaged<{ id: string; unit_number: string }>((a, b) =>
      admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).order("id").range(a, b),
    ),
  ]);
  const report = idleParityReport(idleParityDays(ours, theirs), finalThrough);
  return idleEngineParityView(report, timezone, new Map(vehicles.map((v) => [v.id, v.unit_number])));
}
