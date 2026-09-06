import { type Ref, toValue } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import type { FleetMpgPeriod, FleetMpgSeries } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The fleet's MPG, from the one place that computes it (M4, D-MPG1).
 *
 * ── WHY A BROWSER CALL AND NOT ANOTHER LOCAL SUM ───────────────────────────────────────────────
 * Four surfaces used to compute this figure themselves from the fills they had already fetched, and
 * each was a reasonable local decision. Together they were four implementations of one definition
 * whose numerator ran 1.31–2.41% below an independent witness, and the Dashboard and the Spend trend
 * disagreed by 10.7% for the same week with nothing in the product comparing them. The numerator now
 * comes from odometer readings the vendor asserted (`samsara_odometer_readings`, migration 0311),
 * which a browser cannot see and must not reconstruct.
 *
 * ── WHAT THE CALLER MUST DO WITH THE ANSWER ────────────────────────────────────────────────────
 * `mpg` is null whenever the figure cannot honestly be stated, and `reason` says why in words a
 * fleet manager can act on. A surface renders the dash AND makes the reason reachable — that is not
 * politeness, it is the whole mechanism: a per-mile figure over part of a fleet reads low on miles
 * and high on cost and looks entirely believable, so "—" with no explanation sends the reader
 * looking for a bug and "7.4" over 40% of the fleet sends them nowhere at all.
 *
 * `measuredShare` and `milesSource` travel with every figure, including a withheld one. They are
 * part of the answer (D-MPG1), not decoration a tile may drop.
 */

/** A window, and optionally the trucks it is narrowed to. `undefined` vehicles is the whole fleet. */
export interface FleetMpgQuery {
  from: string;
  to: string;
  /**
   * Truck ids, when a screen is showing some of the fleet. An EMPTY array is not "all trucks" — it
   * is "none of the units named are in this fleet", and the endpoint answers it as such.
   */
  vehicleIds?: string[];
  /** Set when the screen has narrowed to something a truck-scoped figure cannot answer; see below. */
  enabled?: boolean;
}

const params = (q: FleetMpgQuery): string => {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  // Sent only when there IS a scope: an empty `vehicles=` reads as "no scope" on the wire, so a
  // deliberately empty selection is expressed by not enabling the query at all.
  if (q.vehicleIds?.length) p.set("vehicles", q.vehicleIds.join(","));
  return p.toString();
};

/** Fleet MPG for one window. */
export function useFleetMpg(query: Ref<FleetMpgQuery>) {
  return useQuery({
    queryKey: ["fleet_mpg", query],
    placeholderData: keepPreviousData,
    enabled: () => toValue(query).enabled !== false,
    queryFn: async (): Promise<FleetMpgPeriod> => {
      const q = toValue(query);
      const res = await apiFetch<FleetMpgPeriod>(`/api/fueling/fleet-mpg?${params(q)}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not read fleet MPG");
      return res.data;
    },
  });
}

/**
 * Fleet MPG for one window AND its calendar buckets — the trend (D-MPG6).
 *
 * Week grain or coarser, and `total` is the window measured as its own period rather than the mean
 * of the buckets: a headline and the trend beneath it are two honest measurements at two grains, not
 * one reconstructed from the other.
 */
export function useFleetMpgSeries(
  query: Ref<FleetMpgQuery & { grain?: FleetMpgSeries["grain"] }>,
) {
  return useQuery({
    queryKey: ["fleet_mpg_series", query],
    placeholderData: keepPreviousData,
    enabled: () => toValue(query).enabled !== false,
    queryFn: async (): Promise<FleetMpgSeries> => {
      const q = toValue(query);
      const res = await apiFetch<FleetMpgSeries>(
        `/api/fueling/fleet-mpg?${params(q)}&grain=${q.grain ?? "week"}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not read fleet MPG");
      return res.data;
    },
  });
}
