/**
 * The org's recorded fills, projected to the analytics' `SpendLine`.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * The ONE9, California and off-network tabs were built on parsed vendor STATEMENTS, which meant they
 * showed nothing at all until somebody uploaded a PDF — and they answer questions the carrier asks far
 * more often than a statement arrives. `fuel_transactions` has the same fills continuously from the EFS
 * feed, and since the station backfill 98.5% of them carry a `station_id`, so the brand dimension those
 * reports are built on is finally available without a statement.
 *
 * ── RETAIL COMES FROM THE KEPT PRICE REPORTS ────────────────────────────────────────────────────
 * EFS records what we PAID and never what was posted, so this used to return `retailAmount: null` and
 * discount capture had no source at all. Since 0245 the daily Pilot report is KEPT rather than deleted
 * by the next upload, so `fuel_spend_lines` (0246) joins each fill to the price that applied at that
 * station on that day and the discount is finally measurable from the feed.
 *
 * A fill with no same-day price keeps `retailAmount: null`, and that is not the same as a zero
 * discount: `analyzeDiscountCapture` drops those lines rather than scoring them as having captured
 * nothing. A missing upload must not manufacture a shortfall.
 *
 * ── UNRESOLVED STATIONS COUNT AS OFF-NETWORK, DELIBERATELY ──────────────────────────────────────
 * A fill whose site could not be matched has `brand: null`. `analyzePolicyExceptions` treats that as
 * off-network rather than as compliant, which is the honest reading: an unidentified site is certainly
 * not a preferred one.
 */
import type { Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import type { SpendLine } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import type { SpendQueryFilters } from "./useSpendDays";

const PAGE = 1000;
const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const str = (v: unknown): string | null => (v == null ? null : String(v));

export function useSpendLinesQuery(filters: Ref<SpendQueryFilters>) {
  return useQuery({
    queryKey: ["fuel_spend_lines", filters],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SpendLine[]> => {
      const f = filters.value;
      const out: SpendLine[] = [];
      for (let start = 0; ; start += PAGE) {
        const { data, error } = await supabase
          .rpc("fuel_spend_lines", {
            p_from: f.from,
            p_to: f.to,
            p_vehicles: f.vehicleIds.length ? f.vehicleIds : null,
          })
          .range(start, start + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as Record<string, unknown>[];
        for (const r of batch) {
          out.push({
            tranDate: str(r.tran_date),
            brand: str(r.brand),
            state: str(r.state),
            site: str(r.site),
            city: str(r.city),
            unit: str(r.unit),
            driver: str(r.driver),
            product: "diesel",
            tank: r.tank === "reefer" ? "reefer" : "tractor",
            gallons: num(r.gallons),
            netAmount: r.net_amount == null ? null : num(r.net_amount),
            // Null when no report covered that station that day — NOT a zero discount. See the header.
            retailAmount: r.retail_amount == null ? null : num(r.retail_amount),
          });
        }
        if (batch.length < PAGE) break;
      }
      return out;
    },
  });
}
