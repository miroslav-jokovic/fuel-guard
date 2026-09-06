import { mileageDivergence } from "./fleetEfficiency.js";

/**
 * Do two independent measurements of the same fleet's distance agree? (M5, D-MPG1 point 2.)
 *
 * ── WHY THIS EXISTS, AND WHY IT IS THE POINT OF THE WHOLE PLAN ─────────────────────────────────
 * On 2026-09-04 the owner noticed fleet MPG reading differently on different pages. Chasing it found
 * something worse than a duplicated formula. `fuel_spend_days.miles` — the allocated miles the spend
 * report divides — agreed with Samsara's own IFTA jurisdiction miles to within **0.08%** in July
 * 2026 and ran **3.78%** ahead of them in August. The step landed in the week of 2026-07-28.
 *
 * **Nothing noticed for five weeks, and nothing could have**, because nothing in the product ever put
 * the two numbers side by side. The spend report prints those miles AS miles; anything reading them
 * has been ~3.8% high since that week. A person found it by accident, running a third source to
 * decide which of two disagreeing pages was wrong.
 *
 * A ratio of sums CAN be tied out against an independent source. That is most of the argument for
 * D-MPG1, and it is worth exactly nothing unless something actually does it. This is the something.
 *
 * ── WHY IFTA IS THE RIGHT WITNESS, AND WHY IT IS NEVER RECONCILED TO ───────────────────────────
 * Samsara publishes per-jurisdiction miles per vehicle per calendar month, on a pipeline that never
 * touches the fuel: it is not derived from a fill, an odometer interval or an allocation. That
 * independence is the entire value, which is why D-MPG2 forbids bending either figure toward the
 * other. This REPORTS a divergence; it never corrects one. Forcing a tax figure to agree with an
 * operating one is how a filing becomes wrong.
 *
 * ── WHOLE MONTHS ONLY, AND THAT IS THE CALLER'S OBLIGATION ─────────────────────────────────────
 * IFTA is published per calendar month and cannot be cut finer, so a half month of allocated miles
 * against a whole month of jurisdiction miles reads as a 50% collapse that is purely an artefact of
 * the window. This function cannot see that — it is handed two totals — so the caller passes only
 * months lying entirely inside its window, and says so.
 *
 * Pure. No clock, no I/O, no table (D-ARC1).
 */

/**
 * How far apart the two sources may be before it is worth saying so.
 *
 * Measured rather than chosen. Against the same fleet: the two sources agreed to **0.08%** in July
 * 2026; the odometer-measured distance ran **0.62%** from the allocated one over 1–3 September on
 * the 122 trucks both could speak for; and the August 2026 break — the thing this exists to catch —
 * was **3.78%**. So 1.5% sits above every agreement anybody has measured on this fleet and well
 * below the break.
 *
 * **The cost is named:** a drift that settles between 1.5% and 3.8% is real and is not flagged until
 * it grows. That is the price of a threshold that does not cry wolf, and the per-month figures are
 * reported whatever the verdict, so a reader watching a number climb from 0.4% to 1.2% can see it
 * before this rule says anything.
 */
export const MILEAGE_AGREEMENT_TOLERANCE = 0.015;

/** Agrees, diverges, or could not be compared at all — which is not the same as agreeing. */
export type MileageVerdict = "agrees" | "diverges" | "unmeasurable";

/** One calendar month, both sources, in miles. `month` is `YYYY-MM`. */
export interface MonthlyMileage {
  month: string;
  /** What this system says the fleet drove — allocated or measured, the caller's own figure. */
  miles: number;
  /** What the independent source says. Zero or absent means it has nothing for that month. */
  referenceMiles: number;
}

export interface MileageAgreementMonth extends MonthlyMileage {
  /** Signed fraction of the reference: positive means OUR figure is the higher one. */
  divergence: number | null;
  verdict: MileageVerdict;
}

export interface MileageAgreement {
  months: MileageAgreementMonth[];
  /** The month furthest from the reference, by absolute divergence. Null when none could be compared. */
  worst: MileageAgreementMonth | null;
  /** `diverges` if ANY month does; `unmeasurable` when no month could be compared at all. */
  verdict: MileageVerdict;
  /** One sentence for a reader, or null when there is nothing to say. */
  concern: string | null;
}

const pct1 = (f: number) => `${(Math.abs(f) * 100).toFixed(1)}%`;

/** "2026-08" → "August 2026", because a report is read by a person, not by a parser. */
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const i = Number(m) - 1;
  return MONTH_NAMES[i] ? `${MONTH_NAMES[i]} ${y}` : month;
}

/**
 * Compare each month, and say the worst of it in one sentence.
 *
 * A month either side cannot speak for is `unmeasurable` rather than agreeing — an absent feed is not
 * agreement, and a check that read silence as a pass would have been quiet through exactly the
 * outage it exists to catch.
 */
export function assessMileageAgreement(months: readonly MonthlyMileage[]): MileageAgreement {
  const assessed: MileageAgreementMonth[] = months.map((m) => {
    const divergence = mileageDivergence(m.miles, m.referenceMiles);
    return {
      ...m,
      divergence,
      verdict:
        divergence == null
          ? "unmeasurable"
          : Math.abs(divergence) > MILEAGE_AGREEMENT_TOLERANCE
            ? "diverges"
            : "agrees",
    };
  });

  const comparable = assessed.filter((m) => m.divergence != null);
  const worst =
    comparable.length === 0
      ? null
      : comparable.reduce((a, b) => (Math.abs(b.divergence!) > Math.abs(a.divergence!) ? b : a));

  if (worst == null) {
    return {
      months: assessed,
      worst: null,
      verdict: "unmeasurable",
      concern:
        assessed.length === 0
          ? null
          : "No whole month in this window can be checked against the jurisdiction miles Samsara reports, so the distance behind these figures has nothing standing beside it.",
    };
  }
  if (worst.verdict !== "diverges") {
    return { months: assessed, worst, verdict: "agrees", concern: null };
  }
  const direction = worst.divergence! > 0 ? "above" : "below";
  return {
    months: assessed,
    worst,
    verdict: "diverges",
    concern:
      `These miles ran ${pct1(worst.divergence!)} ${direction} the jurisdiction miles Samsara reports for ${monthLabel(worst.month)}. ` +
      `Both measure the same trucks over the same month on pipelines that share nothing, so a gap this size means one of the two moved — ` +
      `every figure derived from distance, not only the efficiency, is off by it until that is settled.`,
  };
}

/**
 * ── THE WIRE SHAPE ─────────────────────────────────────────────────────────────────────────────
 * `GET /api/fueling/mileage-agreement` answers with one of these, and it lives here rather than in
 * the service that assembles it: a contract shared by the API and the web has one home, and a
 * per-app copy is a workaround with a delay fuse (CLAUDE.md, `lint:shared-contracts`).
 */
export interface MileageAgreementResult extends MileageAgreement {
  /** The whole calendar months the check could use, `YYYY-MM`, oldest first. */
  monthsChecked: string[];
  /**
   * True when the window held no whole calendar month.
   *
   * Not a failure and not an agreement: IFTA is published per calendar month and cannot be cut
   * finer, so a one-week report has nothing to check. Saying that is different from saying the miles
   * agree, and a surface that showed nothing for both would hide which it was.
   */
  windowTooShort: boolean;
}
