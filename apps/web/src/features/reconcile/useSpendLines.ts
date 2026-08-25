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
 * ── BOTH PRICES COME FROM THE KEPT PILOT REPORTS ────────────────────────────────────────────────
 * EFS records what we PAID and neither what was posted nor what we were quoted, so this used to return
 * `retailAmount: null` and discount capture had no source at all. Since 0245 the daily Pilot report is
 * KEPT rather than deleted by the next upload, and `fuel_spend_lines` (0247) joins BOTH of its prices
 * onto every fill:
 *
 *   `retailAmount`   ← "Retail Price" × gallons — the posted price, what the discount is measured FROM.
 *   `contractAmount` ← "Your Price"   × gallons — the contracted cost, what the fill SHOULD have been
 *                       billed at. This is the one the reconciliation runs on; measured on production
 *                       it matches what EFS billed to $0.0005/gal on 1,314 of 1,409 quoted fills, so it
 *                       is a reconciliation key and not an estimate.
 *
 * A fill with no quote in range keeps BOTH null, and null is not zero: `analyzeContractCapture` reports
 * those lines as unmeasured rather than scoring them as billed exactly at contract. A missing upload
 * must not read as a clean bill of health.
 *
 * ── SCOPE COMES FROM THE SESSION ────────────────────────────────────────────────────────────────
 * No `p_org` is passed here on purpose. The function is `security invoker`, so a browser is scoped by
 * RLS and by `auth_org_id()` off its own JWT — passing an org from client-side state would add a value
 * a caller could get wrong without adding any authority. `apps/api` is the opposite case and MUST pass
 * it: the service role bypasses RLS. See D-FC1 in migration 0247.
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
            // Null when no quote was in range — NOT a zero discount, and NOT billed at contract.
            retailAmount: r.retail_amount == null ? null : num(r.retail_amount),
            contractAmount: r.contract_amount == null ? null : num(r.contract_amount),
            quoteStaleDays: r.quote_stale_days == null ? null : num(r.quote_stale_days),
          });
        }
        if (batch.length < PAGE) break;
      }
      return out;
    },
  });
}
