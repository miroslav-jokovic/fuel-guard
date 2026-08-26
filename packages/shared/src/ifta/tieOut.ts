/**
 * Two readings of one period's miles, and what it means when they disagree (S2, D-IF9).
 *
 * ── THIS CHECK ALREADY PAID FOR ITSELF, BEFORE IT WAS CODE ───────────────────────────────────────
 * The plan originally proposed tying our fuel out against Samsara's `taxPaidLiters`. Measured, that is
 * 668 gallons a quarter against the 439,153 we hold, because 187 of this carrier's vehicles carry no
 * fuel type in Samsara — it sees almost none of the fuel. So the two readings that actually exist are
 * of MILES: Samsara's jurisdiction totals, and our own odometer chain between fuel fills.
 *
 * Run once by hand on 2026 Q2 they came out **4,611,351** and **2,754,740** — a ratio of 1.66, and not
 * a uniform one: per truck it ran from 1.00 to 7.93. Banding the trucks by that ratio and computing
 * the implied MPG located the cause: where the two agree the implied MPG is 7.26, and where Samsara
 * runs higher it climbs to 11.94. The excess miles were real miles with no fuel behind them, and the
 * fuel turned out to be missing — `efs_transactions` held nothing at all for 2026-04-18 → 2026-05-18,
 * about 226,424 gallons and $1.03M. This module is that reasoning, made repeatable.
 *
 * ── WHY OUR ODOMETER MILES ARE THE WEAKER READING, AND ARE STILL WORTH COMPARING ─────────────────
 * They come from odometer deltas between recorded FILLS, so they cannot see a mile driven either side
 * of the chain — before the first fill of a window, after the last, or across a gap where no fill was
 * recorded. Samsara measures continuously and needs no fill. That asymmetry is the point: our miles
 * are a lower bound on Samsara's, so **Samsara below ours is impossible** and means something is wrong
 * with the mileage feed rather than with the fuel.
 */
import { IFTA_MPG_BAND } from "./position.js";


export interface MilesTieOutInput {
  /** Samsara's taxable miles for the period, summed across jurisdictions. */
  samsaraMiles: number;
  /** Our odometer-derived miles for the same trucks and period. */
  odometerMiles: number;
  /** Our purchased gallons for the period — the denominator that turns a ratio into a verdict. */
  purchasedGallons: number;
}

export type TieOutVerdict =
  | "agree"
  /** Samsara materially above ours, and the implied MPG is still believable — our chain has gaps. */
  | "odometer_short"
  /** Samsara materially above ours AND the implied MPG is impossible — fuel is missing, not miles. */
  | "fuel_missing"
  /** Samsara BELOW ours, which the odometer chain cannot produce honestly. */
  | "samsara_short"
  | "unmeasurable";

export interface MilesTieOut {
  verdict: TieOutVerdict;
  samsaraMiles: number;
  odometerMiles: number;
  /** `samsaraMiles ÷ odometerMiles`. Null when there is nothing to divide. */
  ratio: number | null;
  /** `samsaraMiles ÷ purchasedGallons` — the figure that separates the two "Samsara is higher" cases. */
  impliedMpg: number | null;
  /** What a reader should do about it, in words. Null when the two agree. */
  concern: string | null;
}

/**
 * How far apart the two readings may sit before it is worth saying anything.
 *
 * Ten per cent. Our miles are a lower bound (see the header) so a small shortfall is expected and
 * uninteresting; 1.66 is not small. Measured: six of this fleet's trucks sit inside 1.15 and the
 * fleet as a whole sits at 1.66.
 */
export const TIE_OUT_TOLERANCE = 0.10;

/** Above this the miles cannot have been driven on the fuel we recorded — `IFTA_MPG_BAND.max`,
 *  imported rather than restated so the position and the tie-out can never disagree about it. */
const IMPLAUSIBLE_MPG = IFTA_MPG_BAND.max;

export function tieOutMiles(input: MilesTieOutInput): MilesTieOut {
  const { samsaraMiles, odometerMiles, purchasedGallons } = input;
  const impliedMpg = purchasedGallons > 0 && samsaraMiles > 0 ? samsaraMiles / purchasedGallons : null;

  if (!(samsaraMiles > 0) || !(odometerMiles > 0)) {
    return {
      verdict: "unmeasurable", samsaraMiles, odometerMiles, ratio: null, impliedMpg,
      concern: "One of the two mileage readings is missing for this period, so they cannot be compared.",
    };
  }

  const ratio = samsaraMiles / odometerMiles;

  if (ratio < 1 - TIE_OUT_TOLERANCE) {
    return {
      verdict: "samsara_short", samsaraMiles, odometerMiles, ratio, impliedMpg,
      concern:
        `Samsara reports ${Math.round((1 - ratio) * 100)}% FEWER miles than the odometer chain, which ` +
        "that chain cannot produce honestly — it only ever sees the distance between two recorded " +
        "fills. Something is short on the telematics side: a gateway offline, or trucks missing from " +
        "the report.",
    };
  }

  if (ratio <= 1 + TIE_OUT_TOLERANCE) {
    return { verdict: "agree", samsaraMiles, odometerMiles, ratio, impliedMpg, concern: null };
  }

  // Samsara is materially higher. Which of the two causes it is depends entirely on the fuel.
  if (impliedMpg != null && impliedMpg > IMPLAUSIBLE_MPG) {
    return {
      verdict: "fuel_missing", samsaraMiles, odometerMiles, ratio, impliedMpg,
      concern:
        `Samsara reports ${ratio.toFixed(2)}× the odometer chain's miles, and those miles against the ` +
        `fuel on file imply ${impliedMpg.toFixed(1)} mpg — which no tractor achieves. The miles are ` +
        "real and the FUEL is missing. Look for a gap in the fuel feed over this period before " +
        "trusting any liability computed from it.",
    };
  }

  return {
    verdict: "odometer_short", samsaraMiles, odometerMiles, ratio, impliedMpg,
    concern:
      `Samsara reports ${ratio.toFixed(2)}× the odometer chain's miles, but the fuel on file supports ` +
      `them (${impliedMpg == null ? "no fuel to check" : `${impliedMpg.toFixed(1)} mpg`}). The odometer ` +
      "chain only sees distance between recorded fills, so this is the expected direction — Samsara's " +
      "figure is the one to file on.",
  };
}
