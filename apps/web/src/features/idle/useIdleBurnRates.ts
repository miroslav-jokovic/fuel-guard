import { useQuery } from "@tanstack/vue-query";
import { DECLARED_EQUIPMENT_LABELS, type IdleBurnRatesView } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * What an idling engine burns, as the fleet's own fuel counters measured it (IE4, D-IE5): the
 * learned table beside the rate every idle dollar on the page still uses. The server learns it
 * (`GET /api/idle/engine/burn-rates`); this composable only shapes the answer into table rows.
 */
export interface BurnRateRow {
  key: string;
  equipment: string;
  temperature: string;
  runningHours: number;
  measured: number | null;
  learned: boolean;
}

/** One row per measured group, in the server's order (equipment, then temperature). */
export function burnRateRows(v: IdleBurnRatesView): BurnRateRow[] {
  return v.cells.map((c) => ({
    key: `${c.equipment}|${c.band ?? ""}`,
    equipment: DECLARED_EQUIPMENT_LABELS[c.equipment],
    temperature: c.label,
    runningHours: c.runningHours,
    measured: c.measuredGalPerHour,
    learned: c.learned,
  }));
}

export function useIdleBurnRates() {
  return useQuery({
    queryKey: ["idle_burn_rates"],
    queryFn: async (): Promise<IdleBurnRatesView> => {
      const res = await apiFetch<{ ok: boolean; data?: IdleBurnRatesView; error?: { message?: string } }>(
        "/api/idle/engine/burn-rates",
      );
      if (!res.ok || !res.data?.ok || !res.data.data) {
        throw new Error(res.data?.error?.message ?? res.error?.message ?? "Could not read the idle burn rates");
      }
      return res.data.data;
    },
    // A 60-day window moves by the hour at most; nothing here needs a tighter refresh.
    staleTime: 600_000,
  });
}
