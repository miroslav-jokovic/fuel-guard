import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { IDLE_COST_BASIS_DEFAULTS, type IdleCostBasis } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The cost basis for idle $ — the burn rate and the $/gal an idled gallon is charged at, plus where
 * that price came from (Q9, `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` §7.2).
 *
 * ── IT IS ASKED FOR NOW, NOT COMPUTED HERE ──────────────────────────────────────────────────────
 * This file used to read `idle_settings` and take the median of `fuel_prices` itself, which made it
 * the third implementation of one figure: the Idling page had this one, the fuel-spend REPORT had a
 * settings-only one that charged unpriced days $4.000/gal against this page's truck-stop median, and
 * the Dashboard endpoint was about to need a fourth. `GET /api/idle/cost-basis` is the one answer
 * (`resolveIdleCostBasis`, idle module), and every surface now displays the same dollars.
 *
 * ⚠ **The price moves by ~1.8% with this change, and that is a defect being closed.** The read here
 * asked `fuel_prices` for `.limit(5000)`; PostgREST caps a response at 1,000 rows, so this page has
 * been showing the median of the 1,000 most recent price rows rather than of the 14-day window its
 * own comment claimed. Measured against production 2026-09-21: **$5.978 capped, $5.873 paged**,
 * where the fleet's own fills those days ran $5.79–$6.22.
 *
 * The shape is unchanged — a `ComputedRef` that always has a basis — so callers are untouched. While
 * the request is in flight it reads the documented defaults, which is exactly what the old
 * composable showed before its two queries resolved.
 */
export type { IdleCostBasis };

/**
 * What every surface reads while the request is in flight: the DOCUMENTED defaults, never
 * `undefined`. Four surfaces multiply by this basis, and an undefined here renders as `$NaN` on
 * three of them — the old composable's own fallback for exactly the same moment.
 */
export const IDLE_COST_BASIS_PENDING: IdleCostBasis = { ...IDLE_COST_BASIS_DEFAULTS, priceSource: "default" };

export function useIdleCostBasis() {
  const { data } = useQuery({
    queryKey: ["idle_cost_basis"],
    // The posted board is ingested a few times a day and the server caches its median for five
    // minutes; refetching on the same cadence keeps a long-lived tab honest without asking for an
    // answer that cannot have changed.
    refetchInterval: 300_000,
    queryFn: async (): Promise<IdleCostBasis> => {
      const res = await apiFetch<{ ok: boolean; data?: IdleCostBasis; error?: { message?: string } }>(
        "/api/idle/cost-basis",
      );
      if (!res.ok || !res.data?.ok || !res.data.data) {
        throw new Error(res.data?.error?.message ?? res.error?.message ?? "Could not read the idle cost basis");
      }
      return res.data.data;
    },
  });
  return computed<IdleCostBasis>(() => data.value ?? IDLE_COST_BASIS_PENDING);
}
