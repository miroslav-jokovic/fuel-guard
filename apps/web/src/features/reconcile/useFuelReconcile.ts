import { computed, type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { stateTimeZone, type SystemFill } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useVehiclesQuery } from "@/composables/useVehicles";

/** Station-local business date (YYYY-MM-DD) for a fill — matches the vendor report's TransactionDate,
 *  which is printed in station-local time. Falls back to the UTC date when the state has no known tz. */
function localBusinessDate(iso: string | null, state: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const tz = stateTimeZone(state) ?? "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface ReconWindow {
  from: string; // YYYY-MM-DD (report startDate)
  to: string; // YYYY-MM-DD (report endDate)
}

/**
 * The org's recorded fuel_transactions inside a report window, projected to SystemFill for reconciliation.
 * We widen the UTC fetch by a day each side so a station-local boundary fill isn't missed; the matcher
 * only counts fills whose local business date falls inside the report window.
 */
export function useSystemFillsQuery(window: Ref<ReconWindow | null>) {
  const { data: vehicles } = useVehiclesQuery();
  const unitOf = (id: string | null): string | null =>
    id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? null) : null;

  return useQuery({
    queryKey: ["reconcile_system_fills", window],
    enabled: computed(() => window.value != null),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async (): Promise<SystemFill[]> => {
      const w = window.value!;
      const fromIso = `${addDays(w.from, -1)}T00:00:00.000Z`;
      const toIso = `${addDays(w.to, 1)}T23:59:59.999Z`;
      const PAGE = 1000;
      const out: SystemFill[] = [];
      for (let start = 0; ; start += PAGE) {
        const { data, error } = await supabase
          .from("fuel_transactions")
          .select("id, card_ref, vehicle_id, fueled_at, gallons, total_cost, state, tank_type")
          .gte("fueled_at", fromIso)
          .lte("fueled_at", toIso)
          // BOTH tanks (D-FR7). This filtered to `tractor`, so a reefer line the vendor billed had
          // nothing on our side to match, and the reefer fills we DID record were never offered up as
          // unbilled. The matcher keeps the classes apart itself — it will not pair a reefer line with
          // a tractor fill — so the filter belonged there, not here.
          .order("fueled_at", { ascending: true })
          .range(start, start + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as Array<{
          id: string; card_ref: string | null; vehicle_id: string | null;
          fueled_at: string | null; gallons: number | string | null; total_cost: number | string | null;
          state: string | null; tank_type: string | null;
        }>;
        for (const r of batch) {
          out.push({
            id: r.id,
            cardRef: r.card_ref,
            controlId: null,
            unit: unitOf(r.vehicle_id),
            fueledAt: r.fueled_at,
            tranDate: localBusinessDate(r.fueled_at, r.state),
            tank: r.tank_type === "reefer" ? "reefer" : "tractor",
            gallons: r.gallons == null ? 0 : Number(r.gallons),
            totalCost: r.total_cost == null ? null : Number(r.total_cost),
          });
        }
        if (batch.length < PAGE) break;
      }
      return out;
    },
  });
}
