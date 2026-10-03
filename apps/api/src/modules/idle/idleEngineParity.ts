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
 *              spans the whole day: `aggregateEngineDays` counts a state until the NEXT sample, so a
 *              truck still idling when the sync last ran has that open stretch missing (775 on 10/01:
 *              15.4 h covered, 1.2 h idle stored, 9.8 h idle by Samsara's own states).
 *  - final     the latest FINISHED nightly run's window start (`jobs.stats.from`): the first day of that
 *              window has had its last write, and every day before it too.
 *
 * Nothing switches here. The page and the driver scores move to the engine in a later merge, once
 * this says `pass` (§4 Q-IE16) — until then this is the list a person reads to see whether to trust it.
 *
 * ORG-FILTERED explicitly: the service role bypasses RLS, so every `.eq("org_id")` IS the tenant boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  idleParityFinalThrough,
  idleParityReport,
  organizationTimezone,
  type IdleParityDay,
  type IdleParityReport,
  type IdleParityTruck,
} from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";

interface EngineDayRow {
  vehicle_id: string;
  day: string;
  hours: number;
  driving_sec: number;
  stopped_running_sec: number;
  brief_stop_sec: number;
  // bigint: PostgREST may send it as a string.
  engine_sec: number | string;
  engine_sec_hours: number;
}

interface SamsaraDayRow {
  vehicle_id: string;
  day: string;
  idle_sec: number | null;
  coverage_sec: number | null;
}

export interface IdleEngineParity extends Omit<IdleParityReport, "disagreements"> {
  timezone: string;
  disagreements: (IdleParityTruck & { unit: string })[];
}

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

export async function readIdleEngineParity(admin: SupabaseClient, orgId: string): Promise<IdleEngineParity> {
  const [{ data: org }, nightlyFrom] = await Promise.all([
    admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle(),
    latestNightlyFrom(admin, orgId),
  ]);
  const timezone = organizationTimezone(org?.operating_hours);
  const finalThrough = idleParityFinalThrough(nightlyFrom, timezone);
  const empty = idleParityReport([], finalThrough);
  if (finalThrough == null) return { ...empty, timezone, disagreements: [] };

  const ours = await fetchAllPaged<EngineDayRow>((a, b) =>
    admin
      .from("idle_engine_days")
      .select("vehicle_id, day, hours, driving_sec, stopped_running_sec, brief_stop_sec, engine_sec, engine_sec_hours")
      .eq("org_id", orgId)
      .lte("day", finalThrough)
      .order("day")
      .order("vehicle_id")
      .range(a, b),
  );
  if (ours.length === 0) return { ...empty, timezone, disagreements: [] };
  const firstDay = ours[0]!.day;
  const [theirs, vehicles] = await Promise.all([
    fetchAllPaged<SamsaraDayRow>((a, b) =>
      admin
        .from("vehicle_engine_days")
        .select("vehicle_id, day, idle_sec, coverage_sec")
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
  const samsara = new Map(theirs.map((r) => [`${r.vehicle_id}|${r.day}`, r]));
  const rows: IdleParityDay[] = ours.map((r) => {
    const t = samsara.get(`${r.vehicle_id}|${r.day}`);
    // Our `hours` is the local day's length (a DST day is 23 or 25), so the bar moves with it.
    const s = t != null && t.coverage_sec != null && t.coverage_sec >= r.hours * 3600 ? t.idle_sec : null;
    return {
      vehicleId: r.vehicle_id,
      day: r.day,
      hours: r.hours,
      runningSec: r.driving_sec + r.stopped_running_sec + r.brief_stop_sec,
      stoppedSec: r.stopped_running_sec + r.brief_stop_sec,
      ecuSec: Number(r.engine_sec),
      ecuHours: r.engine_sec_hours,
      samsaraIdleSec: s == null ? null : Number(s),
    };
  });
  const report = idleParityReport(rows, finalThrough);
  const unitById = new Map(vehicles.map((v) => [v.id, v.unit_number]));
  return {
    ...report,
    timezone,
    disagreements: report.disagreements.map((d) => ({ ...d, unit: unitById.get(d.vehicleId) ?? "—" })),
  };
}
