import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";

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
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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

  const statsRows = (stats.data ?? []) as { obdOdometerMeters?: { value?: number }; gpsOdometerMeters?: { value?: number }; fuelPercents?: { value?: number } }[];

  return {
    tokenConfigured: true as const,
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
      withFuelPercents: statsRows.filter((v) => v.fuelPercents?.value != null).length,
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
