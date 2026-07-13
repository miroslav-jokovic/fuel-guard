import { useQuery } from "@tanstack/vue-query";
import {
  computeIdleConfidence,
  computeIdleAgreement,
  type IdleConfidenceResult,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

const PAGE = 1000;
const WINDOW_DAYS = 30;

/**
 * Data-confidence coverage for the idle feature: reads the last 30 days of idle events + the active fleet and
 * computes how complete the inputs are (driver attribution, measured fuel, temperature, equipment, learned
 * capability). Read-only; the weighting/blend lives in the shared pure helper.
 */
export function useIdleConfidence() {
  return useQuery({
    queryKey: ["idle_confidence"],
    queryFn: async (): Promise<IdleConfidenceResult> => {
      const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      const events: {
        classification: string;
        driverId: string | null;
        fuelGal: number | null;
        airTempF: number | null;
        vehicleId: string | null;
        durationSec: number;
      }[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("idle_events")
          .select("classification, driver_id, fuel_gal, air_temp_f, vehicle_id, duration_sec")
          .gte("started_at", from)
          .order("started_at", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as {
          classification: string;
          driver_id: string | null;
          fuel_gal: number | string | null;
          air_temp_f: number | string | null;
          vehicle_id: string | null;
          duration_sec: number | string;
        }[];
        for (const r of batch) {
          events.push({
            classification: r.classification,
            driverId: r.driver_id,
            fuelGal: r.fuel_gal == null ? null : Number(r.fuel_gal),
            airTempF: r.air_temp_f == null ? null : Number(r.air_temp_f),
            vehicleId: r.vehicle_id,
            durationSec: Number(r.duration_sec),
          });
        }
        if (batch.length < PAGE) break;
      }

      // CP6: per-truck idle-events seconds (scored only), to compare against the engine-state idle measure.
      const eventsSecByVehicle = new Map<string, number>();
      for (const e of events) {
        if (e.classification === "brief" || e.vehicleId == null) continue;
        eventsSecByVehicle.set(
          e.vehicleId,
          (eventsSecByVehicle.get(e.vehicleId) ?? 0) + e.durationSec,
        );
      }

      const { data: vdata, error: verr } = await supabase
        .from("vehicles")
        .select("id, has_apu, apu_type, has_optimized_idle, idle_capability, idle_states_sec")
        .neq("status", "retired");
      if (verr) throw new Error(verr.message);
      const rawVehicles = (vdata ?? []) as {
        id: string;
        has_apu: boolean | null;
        apu_type: string | null;
        has_optimized_idle: boolean | null;
        idle_capability: string | null;
        idle_states_sec: number | string | null;
      }[];
      const vehicles = rawVehicles.map((v) => ({
        hasApu: v.has_apu ?? null,
        apuType: v.apu_type ?? null,
        hasOptimizedIdle: v.has_optimized_idle ?? null,
        idleCapability: v.idle_capability ?? null,
      }));
      const agreement = computeIdleAgreement(
        rawVehicles.map((v) => ({
          statesSec: v.idle_states_sec == null ? null : Number(v.idle_states_sec),
          eventsSec: eventsSecByVehicle.get(v.id) ?? 0,
        })),
      );

      return computeIdleConfidence({ events, vehicles, agreement });
    },
    refetchInterval: 120_000,
  });
}
