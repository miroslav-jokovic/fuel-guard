import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { samsaraFetch } from "../lib/samsaraHttp.js";
import { reconcileWithSamsara, SamsaraUnavailableError } from "./samsaraRecon.js";

/**
 * Probe every Samsara endpoint the sync depends on and report exactly what it returns — HTTP status
 * (403 = missing scope), counts, and a raw sample. Lets us diagnose empty Fuel level / assignments
 * without guessing at the response shape. Admin-only, read-only.
 */
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
      return { status: 0, ok: false, data: null, error: e instanceof Error ? e.message : String(e) };
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

  const statsRows = (stats.data ?? []) as { obdOdometerMeters?: { value?: number }; gpsOdometerMeters?: { value?: number }; fuelPercent?: { value?: number }; fuelPercents?: { value?: number } }[];

  // ── Our-side reconciliation readiness: recon can ONLY run for a fill whose vehicle is linked to a Samsara
  // vehicle id. This is the #1 reason coverage can be 0% while Samsara itself is healthy. ──
  const { data: vehRows } = await admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId);
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
  const fills = (fillRows ?? []) as { id: string; vehicle_id: string | null; fueled_at: string; fueled_at_precision: string | null; city: string | null; state: string | null; location_text: string | null; gallons: number | null }[];
  const fillsWithVehicle = fills.filter((f) => f.vehicle_id).length;
  const fillsReconcilable = fills.filter((f) => f.vehicle_id && mappedIds.has(f.vehicle_id)).length;

  // End-to-end test: reconcile ONE recent fill whose vehicle IS mapped, and report exactly what recon does.
  // This isolates "no mapping" vs "history fetch fails" vs "fetched but nothing matched" — without a backfill.
  let testReconcile: Record<string, unknown> = { ran: false, reason: "no recent fill with a Samsara-mapped vehicle" };
  const target = fills.find((f) => f.vehicle_id && mappedIds.has(f.vehicle_id));
  if (target) {
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
        tankCapacityGal: null,
      });
      testReconcile = r
        ? { ran: true, ok: true, fuelingTimeBasis: r.fuelingTimeBasis, locationConfidence: r.locationConfidence, matchedAt: r.matchedAt, samsaraVehicleId: veh?.samsara_vehicle_id }
        : { ran: true, ok: false, reason: "recon returned null — history fetch returned no GPS samples in this fill's ±36h window", samsaraVehicleId: veh?.samsara_vehicle_id, fueledAt: target.fueled_at };
    } catch (e) {
      testReconcile = {
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

  return {
    tokenConfigured: true as const,
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
    },
    vehicles: { status: vehicles.status, error: vehicles.error },
    stats: {
      status: stats.status,
      error: stats.error,
      vehiclesReporting: statsRows.length,
      withObdOdometer: statsRows.filter((v) => v.obdOdometerMeters?.value != null).length,
      withGpsOdometer: statsRows.filter((v) => v.gpsOdometerMeters?.value != null).length,
      withFuelPercents: statsRows.filter((v) => (v.fuelPercent ?? v.fuelPercents)?.value != null).length,
      sample: statsRows[0] ?? null,
    },
    drivers: { status: drivers.status, error: drivers.error },
    assignments: {
      status: assignments.status,
      error: assignments.error,
      rawCount: assignments.data?.length ?? null,
      sample: (assignments.data ?? []).slice(0, 2),
    },
  };
}
