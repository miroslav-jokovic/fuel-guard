import { periodBounds, type SpendGrain } from "../fuelSpend/spendPeriods.js";
import { perMileRate } from "./fleetReport.js";

/**
 * Revenue and activity, by period, from billing alone (W2, §1.8.4 step 2).
 *
 * **What this is for.** The monthly report is the P&L and stays the P&L. What a dispatcher and an
 * owner actually watch between closes is narrower and faster: how many loads went, what they were
 * priced at, and whether the rate per billed mile is moving. All three come from `mcleod_billing`,
 * which is event-dated at the day — so they can be answered weekly today, without the mileage
 * collector that weekly per-DRIVEN-mile figures would need (§1.8.2).
 *
 * **Miles-free on purpose, and the naming says so.** Every rate here is per **billed** mile — the
 * miles the loads were priced on, from `mcleod_billing.distance` — never per mile driven. Samsara's
 * IFTA endpoint is monthly by design and the stats feed keeps no distance history, so a weekly
 * driven figure does not exist to divide by; inventing one by splitting a month across weeks is
 * allocation wearing a measurement's clothes, which D-FLEET8 refuses. "Revenue per billed mile" and
 * "revenue per mile driven" are different questions with different divisors, and neither is ever
 * printed as "per mile" alone (G9).
 *
 * **No cost, and that is D-FLEET10 rather than an omission.** 26.2% of July's expense arrived as 44
 * journal lines averaging $24,210 — the lease, the insurance, the payroll. A weekly cost figure
 * built from those would show three cheap weeks and one enormous one: arithmetically correct and
 * operationally meaningless. Cost joins the weekly view only when it can be labelled by what does
 * and does not happen weekly, which is W4's job.
 *
 * **The week starts on Monday**, and that rule is imported rather than restated: `periodBounds`
 * already decides it for the fuel-spend series, with the reason recorded there — a Sunday-start
 * series would silently disagree with every statement on the desk. Two different weeks in one
 * product is a defect nobody would find until two numbers failed to add up.
 *
 * Pure. No clock, no I/O, no constant that is a dollar, a date or a rate.
 */

/** One bill, reduced to what an activity figure needs. */
export interface ActivityBill {
  /** The day the load DELIVERED — the driving clock, not the invoicing clock (§5). */
  delivery_date: string;
  /** Linehaul plus accessorial, excise tax already excluded by the caller. */
  revenue: number;
  /** McLeod's billed distance for the load. Null when the bill carries none. */
  distance: number | null;
}

export interface ActivityPeriod {
  /** Inclusive, `YYYY-MM-DD`. */
  from: string;
  to: string;
  loads: number;
  revenue: number;
  billedMiles: number;
  /** Revenue ÷ billed miles. Null when the period's bills carry no distance (D-FIN10). */
  revenuePerBilledMile: number | null;
  /** Loads whose bill carried no distance — they count as loads and not as miles. */
  loadsWithoutDistance: number;
}

const round = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * Bucket bills into periods, oldest first.
 *
 * **A period with no bills is omitted, not emitted as a zero.** A week the carrier hauled nothing
 * and a week nobody has swept yet look identical in a zero row, and on a chart the zero is the more
 * believable of the two. The caller knows which periods it asked for and can say what is missing;
 * this function only reports what the bills say.
 *
 * **A bill with no distance still counts as a load.** Dropping it would understate activity to
 * protect a rate, and the rate is protected anyway — its miles are simply not in the denominator,
 * and the count of such loads travels with the row so a reader can see how much of the period the
 * rate is speaking for.
 */
export function bucketBillingActivity(
  bills: readonly ActivityBill[],
  grain: SpendGrain = "week",
): ActivityPeriod[] {
  const byPeriod = new Map<string, ActivityPeriod>();
  for (const b of bills) {
    const day = b.delivery_date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const { from, to } = periodBounds(day, grain);
    let p = byPeriod.get(from);
    if (!p) {
      p = { from, to, loads: 0, revenue: 0, billedMiles: 0, revenuePerBilledMile: null, loadsWithoutDistance: 0 };
      byPeriod.set(from, p);
    }
    p.loads++;
    p.revenue = round(p.revenue + b.revenue);
    if (b.distance == null) p.loadsWithoutDistance++;
    else p.billedMiles = Math.round((p.billedMiles + b.distance) * 10) / 10;
  }

  return [...byPeriod.values()]
    .map((p) => ({ ...p, revenuePerBilledMile: perMileRate(p.revenue, p.billedMiles) }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}
