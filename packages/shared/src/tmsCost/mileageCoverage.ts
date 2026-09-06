/**
 * How many trucks a month measured, and whether that is all of them (G4 + G10).
 *
 * **The problem this exists for, measured 2026-09-03.** Samsara telematics was still being rolled
 * out across this fleet through early 2026. Against trucks that actually delivered a load: January
 * measured 130 of 139, February **135 of 151**. A cost-per-mile figure computed over a denominator
 * missing eleven per cent of the running fleet is inflated by about eleven per cent — February's
 * $2.86 would fall near $2.59 — and nothing on the page would have said so. That is the
 * plausible-but-wrong number the whole finance programme exists to refuse, except it is a whole
 * month of them rather than one truck.
 *
 * **So coverage is computed, never assumed, and never hard-coded as a date.** "Before March 2026"
 * would describe this particular rollout and would say nothing at all about a gateway outage next
 * spring. The rule is a comparison between two counts the data already carries, so it keeps working
 * for a cause nobody has thought of yet.
 *
 * **The truck count itself (G4).** A truck is active in a month when Samsara measured miles for it.
 * That is deliberately the same source as the denominator: any other definition — the McLeod roster
 * (190 tractors in July), trucks that carried a bill (160) — can disagree with the miles it is
 * dividing, and a count that disagrees with its own denominator is worse than no count. July: 172.
 *
 * Pure. No clock, no I/O, no constant that is a month or a threshold.
 */

/** One month's two sides, as the collectors hold them. */
export interface MonthMileageInput {
  /** `YYYY-MM`. */
  month: string;
  /** Vehicles Samsara measured any distance for. This is the truck count (G4). */
  measuredTrucks: number;
  measuredMiles: number;
  /**
   * Trucks that delivered a billed load in the month, from billing re-dated to `delivery_date`.
   * The comparison side only — never a denominator, because it cannot see a truck that ran without
   * delivering (repositioning, shop, out of service), which is exactly why it EXCEEDS the measured
   * count in a healthy month rather than matching it.
   */
  deliveringTrucks: number;
  /** McLeod's billed distance over those loads — the miles the loads were priced on. */
  billedMiles: number;
}

export interface MonthMileage {
  month: string;
  measuredTrucks: number;
  measuredMiles: number;
  deliveringTrucks: number;
  billedMiles: number;
  /**
   * True when Samsara measured at least every truck that delivered. False means the denominator is
   * short and every per-mile figure over this month is `null` (D-FIN10 at month grain).
   */
  complete: boolean;
  /** Trucks that delivered and were not measured. 0 when complete. */
  unmeasuredTrucks: number;
  /**
   * Miles driven that carried no billed load — deadhead, repositioning, shop runs. `null` when
   * coverage is incomplete, because a short driven figure would make empty miles look negative,
   * which is what an earlier reading of February produced (−8.8%) before this rule existed.
   */
  emptyMiles: number | null;
  emptyPct: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Assess each month, newest first.
 *
 * A month with no measured trucks at all is incomplete rather than complete-with-zero: the absence
 * of a measurement is not a measurement of absence, and a fleet does not stop running because a
 * feed stopped reporting.
 */
export function assessMileageCoverage(months: MonthMileageInput[]): MonthMileage[] {
  return months
    .map((m): MonthMileage => {
      const unmeasured = Math.max(0, m.deliveringTrucks - m.measuredTrucks);
      const complete = m.measuredTrucks > 0 && unmeasured === 0;
      const emptyMiles = complete ? round1(m.measuredMiles - m.billedMiles) : null;
      return {
        month: m.month,
        measuredTrucks: m.measuredTrucks,
        measuredMiles: m.measuredMiles,
        deliveringTrucks: m.deliveringTrucks,
        billedMiles: m.billedMiles,
        complete,
        unmeasuredTrucks: unmeasured,
        emptyMiles,
        emptyPct:
          emptyMiles == null || m.measuredMiles <= 0
            ? null
            : round1((emptyMiles / m.measuredMiles) * 100),
      };
    })
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
}

/**
 * The denominator for a period, and the reason when there is none.
 *
 * A period is only measurable when EVERY month it covers is complete: a quarter containing one
 * short month has a short denominator, and averaging over it would bury the gap rather than state
 * it. The reason is written for a reader, not for a log — it is what the page prints beside the
 * dash.
 */
export function periodDenominator(months: MonthMileage[]): {
  miles: number | null;
  trucks: number | null;
  reason: string | null;
} {
  if (!months.length) {
    return { miles: null, trucks: null, reason: "No months of measured miles in this period yet." };
  }
  const short = months.filter((m) => !m.complete);
  if (short.length) {
    // Named months, not a count: "two months are incomplete" sends a reader looking for which.
    const named = short.map((m) => m.month).join(", ");
    const trucks = short.reduce((n, m) => n + m.unmeasuredTrucks, 0);
    return {
      miles: null,
      trucks: null,
      reason:
        trucks > 0
          ? `Some trucks were not yet sending mileage in ${named} — ${trucks} that carried loads were not measured, so a per-mile figure would read low on miles and high on cost.`
          : `No mileage was recorded in ${named}, so there is nothing to divide by.`,
    };
  }
  return {
    miles: months.reduce((n, m) => n + m.measuredMiles, 0),
    // The truck count over a multi-month period is the BUSIEST month, not a sum and not a mean: a
    // truck measured in three months is one truck, and summing would triple the fleet.
    trucks: months.reduce((n, m) => Math.max(n, m.measuredTrucks), 0),
    reason: null,
  };
}
