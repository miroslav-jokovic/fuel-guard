/**
 * The fill sequence the buy-quantity question needs, read through `fuel_buy_fills` (0254).
 *
 * ── WHY NOT `useSpendLines`, WHICH THIS PAGE ALREADY HAS ─────────────────────────────────────────
 * `fuel_spend_lines` answers "what did we spend"; this answers "what happened between two fills", and
 * three of its columns make that impossible. It returns a business DATE, and two fills on one date
 * either side of a state line is precisely the pair this feature exists to find. It returns `unit`, a
 * display string, rather than `vehicle_id`, so a renumbered truck interleaves two chains. And it
 * carries nothing about the tank — no level, no capacity, no odometer miles.
 *
 * ── THE LOOKBACK ARRIVES WITH THE ROWS AND IS NOT FILTERED HERE ──────────────────────────────────
 * The function reaches 14 days before the window and flags those rows `in_window = false`, because a
 * pair needs a fill on BOTH sides: drop them and every truck's first in-window leg is unscored. They
 * are passed straight through to `analyzeCarriedFuel`, which scores a pair on where its ARRIVING fill
 * landed. Filtering them out here would quietly restore the bug the lookback exists to prevent.
 *
 * ── CAPACITY IS RESOLVED HERE, ONCE ──────────────────────────────────────────────────────────────
 * The function returns the entered figure, the sensor-implied one and the largest corroborated
 * observed fill, and `resolveCapacity` reconciles them — flooring the sensor at the observed maximum,
 * because three fills of X gallons are a physical lower bound on a tank and a sensor reading below
 * them is non-linearity, not a smaller tank. That arithmetic has been got wrong before and is tested
 * where it lives; re-deriving any of it here or in SQL would put a second copy where no test reaches.
 */
import { computed, type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { resolveCapacity, type CarriedFuelFill } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function useBuyFillsQuery(window: Ref<{ from: string; to: string }>) {
  return useQuery({
    queryKey: ["fuel_buy_fills", window],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CarriedFuelFill[]> => {
      // `p_org` is deliberately omitted: `fuel_buy_fills` is `security invoker` with
      // `coalesce(p_org, auth_org_id())`, so a browser is scoped by its own JWT (D-FC1). Naming an
      // org here would be no more powerful and would put a tenant id in a query string.
      const { data, error } = await supabase.rpc("fuel_buy_fills", {
        p_from: window.value.from,
        p_to: window.value.to,
      });
      if (error) throw new Error(error.message);

      return ((data ?? []) as Record<string, unknown>[]).map((r) => {
        // `VehicleView`'s shape, with only the fields `resolveCapacity` reads populated: it takes the
        // whole view because it lives beside the rules that need the rest, and the optional capacity
        // columns are `number | undefined` there rather than nullable.
        const cap = resolveCapacity({
          id: String(r.vehicle_id),
          fuelType: "diesel",
          baselineMpg: num(r.baseline_mpg),
          tankCapacityGal: Number(r.entered_capacity_gal ?? 0),
          sensorCapacityGal: num(r.sensor_capacity_gal) ?? undefined,
          observedMaxFillGal: num(r.observed_max_fill_gal) ?? undefined,
        });
        return {
          vehicleId: String(r.vehicle_id),
          unit: r.unit == null ? null : String(r.unit),
          fueledAt: String(r.fueled_at),
          tranDate: r.tran_date == null ? null : String(r.tran_date).slice(0, 10),
          inWindow: r.in_window !== false,
          state: r.state == null ? null : String(r.state),
          gallons: Number(r.gallons ?? 0),
          netAmount: num(r.net_amount),
          milesSinceLast: num(r.miles_since_last),
          baselineMpg: num(r.baseline_mpg),
          levelBeforePct: num(r.level_before_pct),
          tankCapacityGal: cap.gallons > 0 ? cap.gallons : null,
        };
      });
    },
  });
}

/**
 * The in-window fills only — for the state ranking, which describes the period the reader chose.
 *
 * The carried-fuel analysis needs the context rows and this does not: a lookback fill belongs to the
 * window before, and letting it into an average would make two adjacent windows overlap by a fortnight.
 */
export function inWindowOnly(fills: Ref<CarriedFuelFill[] | undefined>) {
  return computed(() => (fills.value ?? []).filter((f) => f.inWindow !== false));
}
