import { useQuery } from "@tanstack/vue-query";
import { odometerMismatches, type OdoMismatchInput, type OdoMismatchReport } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

const PAGE = 1000;
const WINDOW_DAYS = 90;

interface RawRow {
  id: string;
  fueled_at: string;
  odometer: number | string | null;
  samsara_odometer: number | string | null;
  fueling_time_basis: string | null;
  samsara_location_confidence: string | null;
  samsara_odometer_at: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  vehicles: { unit_number: string; odometer_offset: number | string | null } | null;
  drivers: { full_name: string } | null;
}

async function loadTolerance(): Promise<number> {
  const { data } = await supabase.from("anomaly_thresholds").select("odometer_tolerance_miles").maybeSingle();
  const t = data?.odometer_tolerance_miles;
  return t == null ? 10 : Number(t);
}

/**
 * Per-fill odometer mismatches (driver-entered vs Samsara at the fueling instant) over the last
 * WINDOW_DAYS. Pages fuel_transactions (RLS-scoped), reads the org's configured tolerance so the tab
 * agrees with the anomaly engine, and runs the pure aggregator. Read-only — never writes or flags.
 */
export function useOdometerMismatches() {
  return useQuery({
    queryKey: ["odometer_mismatches"],
    queryFn: async (): Promise<OdoMismatchReport> => {
      const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      const tolerance = await loadTolerance();
      const rows: OdoMismatchInput[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("fuel_transactions")
          .select(
            "id, fueled_at, odometer, samsara_odometer, samsara_odometer_at, fueling_time_basis, samsara_location_confidence, vehicle_id, driver_id, vehicles(unit_number, odometer_offset), drivers(full_name)",
          )
          .gte("fueled_at", from)
          .not("odometer", "is", null)
          .not("samsara_odometer", "is", null)
          .order("fueled_at", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as unknown as RawRow[];
        for (const r of batch) {
          rows.push({
            id: r.id,
            fueledAt: r.fueled_at,
            vehicleId: r.vehicle_id,
            unit: r.vehicles?.unit_number ?? null,
            driverId: r.driver_id,
            driverName: r.drivers?.full_name ?? null,
            entered: r.odometer == null ? null : Number(r.odometer),
            samsara: r.samsara_odometer == null ? null : Number(r.samsara_odometer),
            odometerOffset: r.vehicles?.odometer_offset == null ? 0 : Number(r.vehicles.odometer_offset),
            timeBasis: r.fueling_time_basis,
            locationConfidence: r.samsara_location_confidence,
            samsaraOdometerAt: r.samsara_odometer_at,
          });
        }
        if (batch.length < PAGE) break;
      }
      return odometerMismatches(rows, tolerance);
    },
    refetchInterval: 120_000,
  });
}
