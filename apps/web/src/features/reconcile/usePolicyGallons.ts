/**
 * The tractor gallons Buy discipline grades its fuel targets from, added up in the database
 * (`fuel_policy_gallons`, 0416, Q-FSV16).
 *
 * ── WHY THIS REPLACES THE ROW DOWNLOAD FOR THE GRADES ────────────────────────────────────────────
 * The on-network share and the avoided-state gallons are sums, and the page used to get them by
 * downloading every `fuel_spend_lines` row — 5,866 on production, in six sequential PostgREST pages that
 * each re-ran the whole function under row-level security, about nine seconds with the grading sections
 * empty. Measured on production 2026-10-03 for the 90 days to that date, as a signed-in admin: this call
 * returns **393 cells** and every one equals the raw rows grouped separately (0 mismatched, 679,255.580
 * gallons on both sides); it takes about 1.5 s, one run of `fuel_spend_lines` instead of six.
 *
 * ── SQL RETURNS THE MEASUREMENT, `gradePolicyCells` OWNS THE VERDICT ─────────────────────────────
 * Nothing here knows a preferred brand or an avoided state. Those come from the carrier's settings and are
 * applied by `gradePolicyCells` in `@silvicom/shared`, which is also where "a station that could not be
 * matched counts as off-network" is written. A cell with a null brand arrives for that reason.
 *
 * ── IT PAGES, BECAUSE 393 IS NOT A BOUND ─────────────────────────────────────────────────────────
 * One cell per month, brand and state means a year-long window is several times 393, and PostgREST caps
 * every response at 1,000 rows however many the function has (the cap that left `fuel_buy_fills` reading
 * a sixth of the fleet, F5). The function's ORDER BY is the group key, so it is a total order and `range`
 * pages are safe. The paging is `readAllBuyFillRows`, not a copy of it.
 *
 * ── SCOPE COMES FROM THE SESSION ─────────────────────────────────────────────────────────────────
 * No `p_org`: the function is `security invoker` and `fuel_spend_lines` does `coalesce(p_org, auth_org_id())`,
 * so a browser is scoped by its own JWT (D-FC1). Naming an org here would add no authority.
 */
import type { Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import type { PolicyGallonCell } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import type { SpendQueryFilters } from "./useSpendDays";
import { readAllBuyFillRows } from "./useBuyFills";

const str = (v: unknown): string | null => (v == null ? null : String(v));

export function usePolicyGallonsQuery(filters: Ref<SpendQueryFilters>) {
  return useQuery({
    queryKey: ["fuel_policy_gallons", filters],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PolicyGallonCell[]> => {
      const f = filters.value;
      const rows = await readAllBuyFillRows((start, end) =>
        supabase
          .rpc("fuel_policy_gallons", {
            p_from: f.from,
            p_to: f.to,
            p_vehicles: f.vehicleIds.length ? f.vehicleIds : null,
          })
          .range(start, end),
      );
      return rows.map((r) => ({
        month: str(r.month),
        brand: str(r.brand),
        state: str(r.state),
        // `numeric` arrives as a string over PostgREST.
        gallons: Number(r.gallons) || 0,
      }));
    },
  });
}
