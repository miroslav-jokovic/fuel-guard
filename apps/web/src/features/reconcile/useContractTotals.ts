/**
 * The four sums behind the "Paid vs Pilot quote" tile, added up in the database
 * (`fuel_contract_totals`, 0418, Q-FSV18).
 *
 * ── WHY THE TILE NO LONGER WAITS FOR EVERY ROW ───────────────────────────────────────────────────
 * Its headline — net dollars over or under contract, and the share of the bill that was priced — is a
 * sum, and it used to come from downloading every `fuel_spend_lines` row (about 5,850 on production, six
 * sequential PostgREST pages that each re-ran the whole function under row-level security, roughly nine
 * seconds). Measured on production 2026-10-03 for the 90 days to that date, as a signed-in admin: the
 * one-row answer equals the raw rows summed separately on every figure (3,754 measured fills,
 * $2,442,173.23 billed against $2,441,594.70 expected, 1,902 unmeasured fills, $1,077,332.78 unmeasured),
 * and takes about 1.7 s, one run of `fuel_spend_lines` instead of six.
 *
 * ── SQL RETURNS THE MEASUREMENT, `contractHeadline` OWNS THE FIGURES ─────────────────────────────
 * The subtraction, the rounding and the priced share are `contractHeadline` in `@silvicom/shared`, which
 * `analyzeContractCapture` also calls, so the tile and the fills list under it cannot disagree about how
 * they are computed. The tolerance that decides a fill is "over" is not needed here and stays there.
 *
 * ── ONE ROW, SO NO PAGING ────────────────────────────────────────────────────────────────────────
 * The function is an aggregate with no GROUP BY: always exactly one row, so PostgREST's 1,000-row cap
 * cannot cut it short, and a response without one is a failure, not an empty window.
 *
 * ── SCOPE COMES FROM THE SESSION ─────────────────────────────────────────────────────────────────
 * No `p_org`: the function is `security invoker` and `fuel_spend_lines` does `coalesce(p_org, auth_org_id())`,
 * so a browser is scoped by its own JWT (D-FC1).
 */
import type { Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import type { ContractTotals } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import type { SpendQueryFilters } from "./useSpendDays";

/** `numeric` arrives as a string over PostgREST, and a sum over nothing is 0 in SQL, never null. */
const num = (v: unknown): number => Number(v) || 0;

export function useContractTotalsQuery(filters: Ref<SpendQueryFilters>) {
  return useQuery({
    queryKey: ["fuel_contract_totals", filters],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ContractTotals> => {
      const f = filters.value;
      const { data, error } = await supabase.rpc("fuel_contract_totals", {
        p_from: f.from,
        p_to: f.to,
        p_vehicles: f.vehicleIds.length ? f.vehicleIds : null,
      });
      if (error) throw new Error(error.message);
      const row = (data as Record<string, unknown>[] | null)?.[0];
      // An aggregate always answers with one row. None means the call did not really succeed, and reading
      // that as zero fuel would say "no fill matched a quote" about a request that never ran.
      if (!row) throw new Error("fuel_contract_totals returned no row");
      return {
        measuredLines: num(row.measured_lines),
        measuredGallons: num(row.measured_gallons),
        measuredPaid: num(row.measured_paid),
        measuredExpected: num(row.measured_expected),
        unmeasuredLines: num(row.unmeasured_lines),
        unmeasuredPaid: num(row.unmeasured_paid),
      };
    },
  });
}
