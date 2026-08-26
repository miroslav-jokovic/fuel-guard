/**
 * Which days in the window can be priced at all.
 *
 * ── WHY THIS IS THE MOST USEFUL THING ON THE DISCOUNT TAB ────────────────────────────────────────
 * Discount capture scores each fill against the price Pilot quoted for that station that day, and
 * quotes come from a report somebody uploads. Measured on production 2026-08-25, `fuel_prices` held
 * twenty days — 2026-08-02 onward — while the page's window defaults to ninety, so **72% of the
 * default view's spend could never be priced**. F1 put that share beside the headline, which stops it
 * misleading anybody. This is the other half: saying WHICH days are missing, because that is the only
 * thing a reader can act on.
 *
 * Read through `fuel_price_coverage` (0251) rather than grouped from the fills the page already has.
 * The client-side version would be wrong twice: it only sees days that have FILLS, so a day with
 * neither a fill nor a quote looks identical to a fully covered one; and it cannot see quotes outside
 * the window, which is exactly what "quotes start on the 2nd" needs to know.
 */
import type { Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";

export interface PriceCoverageDay {
  day: string;
  /** Distinct stations quoted that day. 0 means no report covered it. */
  quotedSites: number;
  /** 0 same-day, 1 carried forward, null when no quote exists at or before this day. */
  staleDays: number | null;
}

export interface PriceCoverage {
  days: PriceCoverageDay[];
  /** Days whose own report exists. */
  covered: number;
  /** Days with no report of their own but one close enough behind to carry forward. */
  carried: number;
  /** Days no quote can reach. These are the ones that cost the reader measurable spend. */
  uncovered: number;
  /** The first day in the window a quote can reach, or null when none can. */
  firstPricedDay: string | null;
  lastPricedDay: string | null;
}

/**
 * How far a quote may be carried before a fill counts as unpriced.
 *
 * ONE, matching `fuel_spend_lines`' own `p_max_stale_days` (0248). If these two disagreed the strip
 * would colour a day green that the analyzer had already refused to price, which is a worse failure
 * than showing nothing: it would say the coverage problem was fixed when it was not.
 */
const MAX_STALE = 1;

export function usePriceCoverageQuery(window: Ref<{ from: string; to: string }>) {
  return useQuery({
    queryKey: ["fuel_price_coverage", window],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PriceCoverage> => {
      const { data, error } = await supabase.rpc("fuel_price_coverage", {
        p_from: window.value.from,
        p_to: window.value.to,
      });
      if (error) throw new Error(error.message);

      const days: PriceCoverageDay[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        day: String(r.day),
        quotedSites: Number(r.quoted_sites ?? 0),
        staleDays: r.stale_days == null ? null : Number(r.stale_days),
      }));

      const reachable = (d: PriceCoverageDay) => d.staleDays != null && d.staleDays <= MAX_STALE;
      const priced = days.filter(reachable);
      return {
        days,
        covered: days.filter((d) => d.quotedSites > 0).length,
        carried: days.filter((d) => d.quotedSites === 0 && reachable(d)).length,
        uncovered: days.filter((d) => !reachable(d)).length,
        firstPricedDay: priced[0]?.day ?? null,
        lastPricedDay: priced[priced.length - 1]?.day ?? null,
      };
    },
  });
}

/** True when narrowing to the priced range would actually change what the reader is looking at. */
export function pricedRangeIsNarrower(c: PriceCoverage | null | undefined): boolean {
  return !!c && c.uncovered > 0 && c.firstPricedDay != null;
}

export const coverageShare = (c: PriceCoverage | null | undefined): number | null =>
  !c || c.days.length === 0 ? null : (c.covered + c.carried) / c.days.length;

export { MAX_STALE as MAX_CARRY_FORWARD_DAYS };
