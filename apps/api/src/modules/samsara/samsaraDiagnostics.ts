import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "./lib/samsaraToken.js";
import { samsaraFetch } from "./lib/samsaraHttp.js";
import { reconcileWithSamsara, SamsaraUnavailableError } from "./samsaraRecon.js";

/**
 * Probe every Samsara endpoint the sync depends on and report exactly what it returns — HTTP status
 * (403 = missing scope), counts, and a raw sample. Lets us diagnose empty Fuel level / assignments
 * without guessing at the response shape. Admin-only, read-only.
 */
/**
 * Reduce a value to its STRUCTURE — keys mapped to value TYPES (and arrays to their first element's shape),
 * never the values themselves. Lets the HOS probes reveal Samsara's exact field names for the parser without
 * returning driver PII (names / duty status). Depth-limited.
 */
function describeShape(v: unknown, depth = 4): unknown {
  if (v === null || v === undefined) return v === null ? "null" : "undefined";
  if (Array.isArray(v)) return v.length ? [describeShape(v[0], depth)] : [];
  const t = typeof v;
  if (t !== "object") return t; // "string" | "number" | "boolean"
  if (depth <= 0) return "object";
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>))
    out[k] = describeShape((v as Record<string, unknown>)[k], depth - 1);
  return out;
}

type DiagFill = {
  id: string;
  vehicle_id: string | null;
  fueled_at: string;
  fueled_at_precision: string | null;
  city: string | null;
  state: string | null;
  location_text: string | null;
  gallons: number | null;
};
type DiagVeh = { id: string; samsara_vehicle_id: string | null };

/** End-to-end recon probe: reconcile ONE recent fill whose vehicle is Samsara-mapped, isolating "no mapping"
 *  vs "history fetch fails" vs "fetched but nothing matched" — without a backfill. */
async function runTestReconcile(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  fills: DiagFill[],
  ourVehicles: DiagVeh[],
  mappedIds: Set<string>,
): Promise<Record<string, unknown>> {
  const target = fills.find((f) => f.vehicle_id && mappedIds.has(f.vehicle_id));
  if (!target) return { ran: false, reason: "no recent fill with a Samsara-mapped vehicle" };
  const veh = ourVehicles.find((v) => v.id === target.vehicle_id);
  try {
    const r = await reconcileWithSamsara(admin, env, orgId, {
      vehicleId: target.vehicle_id,
      samsaraVehicleId: veh?.samsara_vehicle_id ?? null,
      fueledAt: target.fueled_at,
      city: target.city,
      state: target.state,
      locationName: target.location_text,
      preciseTime: target.fueled_at_precision === "instant",
      gallons: target.gallons,
      // Connectivity probe only — no VehicleView is loaded here, so capacity stays unknown
      // (reconcileWithSamsara resolves it from the vehicle; audit 2026-08-09, finding A).
      vehicle: null,
    });
    return r
      ? {
          ran: true,
          ok: true,
          fuelingTimeBasis: r.fuelingTimeBasis,
          locationConfidence: r.locationConfidence,
          matchedAt: r.matchedAt,
          samsaraVehicleId: veh?.samsara_vehicle_id,
        }
      : {
          ran: true,
          ok: false,
          reason:
            "recon returned null — history fetch returned no GPS samples in this fill's ±36h window",
          samsaraVehicleId: veh?.samsara_vehicle_id,
          fueledAt: target.fueled_at,
        };
  } catch (e) {
    return {
      ran: true,
      ok: false,
      reason:
        e instanceof SamsaraUnavailableError
          ? "Samsara stats/HISTORY fetch FAILED (this is what silently zeros coverage — check the request/scope for /fleet/vehicles/stats/history)"
          : `error: ${e instanceof Error ? e.message : String(e)}`,
      samsaraVehicleId: veh?.samsara_vehicle_id,
    };
  }
}

/**
 * Data-health snapshot for the diagnostics panel: top tables by size (via the 0115 SECURITY DEFINER
 * RPC — service-role only) + the last retention run's summary. Best-effort: an unapplied 0115 shows a
 * hint instead of failing diagnostics.
 */
async function dataHealthSection(admin: SupabaseClient, orgId: string) {
  const { data, error } = await admin.rpc("admin_table_stats");
  const rows = (data ?? []) as { table_name: string; live_rows: number; dead_rows: number; total_bytes: number }[];
  const mb = (b: number) => Math.round((b / 1_048_576) * 10) / 10;
  const { data: lastRet } = await admin
    .from("jobs")
    .select("status, finished_at, stats, error")
    .eq("org_id", orgId)
    .eq("kind", "data_retention")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    error: error ? `${error.message} (apply migration 0115)` : null,
    topTables: rows.slice(0, 15).map((r) => ({
      table: r.table_name,
      liveRows: r.live_rows,
      deadRows: r.dead_rows,
      sizeMb: mb(r.total_bytes),
    })),
    totalMb: mb(rows.reduce((s, r) => s + Number(r.total_bytes), 0)),
    lastRetentionRun: lastRet ?? null,
  };
}

export async function runSamsaraDiagnostics(admin: SupabaseClient, env: Env, orgId: string) {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) return { tokenConfigured: false as const };

  const probe = async (path: string, params: Record<string, string> = {}) => {
    const url = new URL(path, env.SAMSARA_API_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    try {
      // retry:false — diagnostics must REPORT the raw status (403 = missing scope), not retry it away.
      const res = await samsaraFetch(env, token, url, { retry: false });
      const body = res.ok ? ((await res.json()) as { data?: unknown[] }) : null;
      const text = res.ok ? null : (await res.text()).slice(0, 300);
      return { status: res.status, ok: res.ok, data: body?.data ?? null, error: text };
    } catch (e) {
      return {
        status: 0,
        ok: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);

  const [vehicles, stats, drivers, assignments] = await Promise.all([
    probe("/fleet/vehicles", { limit: "1" }),
    probe("/fleet/vehicles/stats", { types: "obdOdometerMeters,gpsOdometerMeters,fuelPercents" }),
    probe("/fleet/drivers", { limit: "1" }),
    probe("/fleet/driver-vehicle-assignments", {
      filterBy: "vehicles",
      startTime: dayAgo.toISOString(),
      endTime: now.toISOString(),
    }),
  ]);

  // Driver-performance feeds (docs/16): confirm scope + reachability. Efficiency needs end ≤3h before now.
  const wkStart = new Date(now.getTime() - 7 * 86_400_000);
  const floorHourMs = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000; // efficiency endpoint requires hour-aligned bounds
  const effStart = new Date(floorHourMs(now.getTime() - 8 * 86_400_000));
  const effEnd = new Date(floorHourMs(now.getTime() - 4 * 3_600_000));
  const [safetyScores, driverEfficiency] = await Promise.all([
    probe("/safety-scores/drivers", {
      startTime: wkStart.toISOString(),
      endTime: now.toISOString(),
    }),
    probe("/driver-efficiency/drivers", {
      startTime: effStart.toISOString(),
      endTime: effEnd.toISOString(),
      dataFormats: "score",
    }),
  ]);

  // HOS feeds — logs (historical duty timeline, drives the idle rest/work overlay) + clocks (current status).
  // Return only the SHAPE so we can pin Samsara's real field names for the parsers without leaking PII.
  const [hosLogs, hosClocks] = await Promise.all([
    probe("/fleet/hos/logs", { startTime: wkStart.toISOString(), endTime: now.toISOString() }),
    probe("/fleet/hos/clocks", {}),
  ]);

  const statsRows = (stats.data ?? []) as {
    obdOdometerMeters?: { value?: number };
    gpsOdometerMeters?: { value?: number };
    fuelPercent?: { value?: number };
    fuelPercents?: { value?: number };
  }[];

  // ── Our-side reconciliation readiness: recon can ONLY run for a fill whose vehicle is linked to a Samsara
  // vehicle id. This is the #1 reason coverage can be 0% while Samsara itself is healthy. ──
  const { data: vehRows } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id")
    .eq("org_id", orgId);
  const ourVehicles = (vehRows ?? []) as { id: string; samsara_vehicle_id: string | null }[];
  const mappedIds = new Set(ourVehicles.filter((v) => v.samsara_vehicle_id).map((v) => v.id));

  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const { data: fillRows } = await admin
    .from("fuel_transactions")
    .select("id, vehicle_id, fueled_at, fueled_at_precision, city, state, location_text, gallons")
    .eq("org_id", orgId)
    .gte("fueled_at", since)
    .order("fueled_at", { ascending: false })
    .limit(2000);
  const fills = (fillRows ?? []) as {
    id: string;
    vehicle_id: string | null;
    fueled_at: string;
    fueled_at_precision: string | null;
    city: string | null;
    state: string | null;
    location_text: string | null;
    gallons: number | null;
  }[];
  const fillsWithVehicle = fills.filter((f) => f.vehicle_id).length;
  const fillsReconcilable = fills.filter((f) => f.vehicle_id && mappedIds.has(f.vehicle_id)).length;

  const testReconcile = await runTestReconcile(admin, env, orgId, fills, ourVehicles, mappedIds);
  const dataHealth = await dataHealthSection(admin, orgId);

  return {
    tokenConfigured: true as const,
    dataHealth,
    reconReadiness: {
      vehiclesTotal: ourVehicles.length,
      vehiclesMappedToSamsara: mappedIds.size,
      fillsLast90d: fills.length,
      fillsWithVehicle,
      fillsReconcilable, // fills whose vehicle is Samsara-linked — the max that CAN get telematics
      testReconcile,
    },
    scopes: {
      readVehicles: vehicles.status === 200,
      readVehicleStats: stats.status === 200,
      readDrivers: drivers.status === 200,
      readAssignments: assignments.status === 200,
      readSafetyScores: safetyScores.status === 200,
      readDriverEfficiency: driverEfficiency.status === 200,
      readHosLogs: hosLogs.status === 200,
      readHosClocks: hosClocks.status === 200,
    },
    vehicles: { status: vehicles.status, error: vehicles.error },
    stats: {
      status: stats.status,
      error: stats.error,
      vehiclesReporting: statsRows.length,
      withObdOdometer: statsRows.filter((v) => v.obdOdometerMeters?.value != null).length,
      withGpsOdometer: statsRows.filter((v) => v.gpsOdometerMeters?.value != null).length,
      withFuelPercents: statsRows.filter((v) => (v.fuelPercent ?? v.fuelPercents)?.value != null)
        .length,
      sample: statsRows[0] ?? null,
    },
    drivers: { status: drivers.status, error: drivers.error },
    assignments: {
      status: assignments.status,
      error: assignments.error,
      rawCount: assignments.data?.length ?? null,
      sample: (assignments.data ?? []).slice(0, 2),
    },
    safetyScores: {
      status: safetyScores.status,
      error: safetyScores.error,
      count: (safetyScores.data ?? []).length,
    },
    driverEfficiency: {
      status: driverEfficiency.status,
      error: driverEfficiency.error,
      count: (driverEfficiency.data ?? []).length,
    },
    hosLogs: {
      status: hosLogs.status,
      error: hosLogs.error,
      rawCount: hosLogs.data?.length ?? null,
      shape: describeShape((hosLogs.data ?? [])[0] ?? null),
    },
    hosClocks: {
      status: hosClocks.status,
      error: hosClocks.error,
      rawCount: hosClocks.data?.length ?? null,
      shape: describeShape((hosClocks.data ?? [])[0] ?? null),
    },
  };
}
