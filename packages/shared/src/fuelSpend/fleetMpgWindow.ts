/**
 * WHICH DAYS A FLEET MPG MAY BE MEASURED OVER — the question `fleetEfficiency.ts` does not answer.
 *
 * That file decides what two totals divide to. This one decides which days may contribute to them,
 * and it is a separate question for the reason `spendPeriods` is separate from `spendPeriodTotals`:
 * choosing the days and dividing the totals are got wrong in different ways, and only one of them
 * has an arithmetic answer.
 *
 * ── WHY THIS EXISTS: THE NUMERATOR AND THE DENOMINATOR COME FROM DIFFERENT CLOCKS ───────────────
 * Fleet MPG pairs odometer readings with `fuel_spend_days` gallons. Those two sources do not stop at
 * the same moment and never will:
 *
 *  · The odometer feed is a COLLECTOR. It stages what Samsara asserted, hourly, and reaches ~now.
 *  · The gallons are a DERIVATION. `fuel_spend_days` is rebuilt by a nightly sweep, so it reaches
 *    yesterday on a good day — and, when the sweep breaks, wherever it stopped.
 *
 * A window whose end is past the derivation's reach therefore has miles in its tail and no gallons,
 * and the ratio is inflated by roughly the reciprocal of the covered share. Measured 2026-09-20: the
 * sweep had been dead for a week (D-PREC1), five of a thirty-day window's days had miles and no
 * gallons, and the dashboard read **8.61 MPG against a true 6.91** — a 25% overstatement that looked
 * entirely believable and sat above a trend chart whose every week read 6.3–7.1.
 *
 * ── WHY `measuredShare` COULD NOT SEE IT, WHICH IS THE WHOLE POINT ──────────────────────────────
 * `computeFleetMpg` already carries a coverage term, and during that week it read **0.966**. It is
 * the share of the period's fuel that has a measured distance behind it — a statement about TRUCKS.
 * This failure is a statement about TIME. `fleetMpg.ts`'s header had said so in as many words since
 * the module was written ("it is a coverage figure, not a timing one") and nothing acted on it. Two
 * different questions need two different terms; one of them cannot be stretched to cover the other.
 *
 * ── THE ANSWER IS TO CLAMP, NOT MERELY TO REFUSE (Q2, revised 2026-09-21) ───────────────────────
 * The audit's Q2 recommended refusing a window whose fuel data does not reach its end, on the
 * finance section's precedent. Refusing is the wrong half of the answer on its own: the bias is not
 * a property of the fleet, it is a property of the two windows being different lengths, so making
 * them the SAME length removes it completely rather than declining to report it. A month whose
 * gallons reach the 19th is answered over the 1st–19th, exactly, with both sources cut on the 19th —
 * which is the same clamp `bucketWindow` already applies to a part-week and `SpendPeriod.partial`
 * already applies to a part-period, for the same reason.
 *
 * So: clamp, say so, and refuse only the two cases a clamp cannot rescue —
 *
 *  1. **There is nothing to clamp to.** The derivation has never run, or it stops before the window
 *     even opens. `computeFleetMpg` would call this "no tractor fuel was purchased", which is a
 *     different claim about the world and would send a reader to look at their fuel cards.
 *  2. **The clamp answers a different question.** Below `MIN_WINDOW_COVERED` the figure is honest
 *     and is about a period nobody asked about.
 */

/** A calendar day, `YYYY-MM-DD`. Compared as a string throughout — ISO days sort correctly. */
type Ymd = string;

/**
 * How much of the requested window must survive the clamp before the answer is still an answer to
 * the question asked.
 *
 * ⚠ **This constant has no measurement behind it, unlike every other threshold in this module, and
 * saying so is part of it.** `MIN_MEASURED_SHARE` is 0.6 because that is what the spend report had
 * enforced since migration 0244 and it had held; `PLAUSIBLE_FLEET_MPG` is 3–12 because that is what
 * a Class-8 tractor physically does. This one is a judgement about WHICH QUESTION is being answered,
 * and a question is not a quantity. A half is the point past which "the last 30 days" has plainly
 * become "some other fortnight", and it is deliberately loose because the clamp has already removed
 * the measurement error — what is left is a labelling risk, not a wrong number.
 *
 * What would change it: a surface that prints the measured window prominently enough that a reader
 * cannot mistake it for the requested one could lower this to nothing. Until one does, this is the
 * backstop for a caption being dropped.
 */
export const MIN_WINDOW_COVERED = 0.5;

const dayCount = (from: Ymd, to: Ymd): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export interface FleetMpgWindow {
  /** The day the measurement opens on. Never clamped — a missing PAST is a gap, not a short window. */
  from: Ymd;
  /** The day it closes on, CLAMPED to the gallons' own reach. Both sources are cut here. */
  to: Ymd;
  /** What the caller asked for, so a surface can tell the two apart without being told separately. */
  requestedTo: Ymd;
  /** True when `to < requestedTo` — the answer is about a shorter period than the question. */
  partial: boolean;
  /** The last day the fuel rollup has derived. Null when it has never derived one. */
  fuelThrough: Ymd | null;
  /** Non-null when no window can be measured at all; the sentence a fleet manager can act on. */
  refusal: string | null;
}

/**
 * Resolve the days a fleet MPG may be measured over, given how far the gallons actually reach.
 *
 * `fuelThrough` is the watermark — `max(day)` in `fuel_spend_days` for the org. It is the right
 * instrument rather than a count of rows, because a day on which no truck happened to fuel still
 * gets rows from the engine feed, so the maximum tracks the DERIVATION's reach and not the fleet's
 * fuelling habits. It is read org-wide even when the caller has scoped to a few trucks: how far the
 * sweep got is a property of the sweep.
 *
 * Pure. No clock — "today" is not consulted and must not be, or the same window would resolve
 * differently depending on when it was asked (D-FLEET6).
 */
export function resolveFleetMpgWindow(
  from: Ymd,
  requestedTo: Ymd,
  fuelThrough: Ymd | null,
): FleetMpgWindow {
  const base = { from, requestedTo, fuelThrough, partial: false, to: requestedTo };

  if (fuelThrough == null) {
    return {
      ...base,
      refusal:
        "The daily fuel roll-up has not produced a single day yet, so there are no gallons to divide by. " +
        "This is the feed, not the fleet — nothing here says anything about what the trucks bought.",
    };
  }

  if (fuelThrough < from) {
    return {
      ...base,
      refusal:
        `The daily fuel roll-up stops on ${fuelThrough}, before this period even opens, so every mile here ` +
        "would be divided by no fuel at all. The roll-up has stalled; the fills themselves are not missing.",
    };
  }

  if (fuelThrough >= requestedTo) return { ...base, refusal: null };

  // Clamped. Both the odometer difference and the gallons will now be cut on the same day, so the
  // figure is unbiased for the days it covers — the only thing lost is days, and they are named.
  const covered = dayCount(from, fuelThrough) / dayCount(from, requestedTo);
  if (covered < MIN_WINDOW_COVERED) {
    return {
      ...base,
      to: fuelThrough,
      partial: true,
      refusal:
        `The daily fuel roll-up only reaches ${fuelThrough}, which is ${Math.round(covered * 100)}% of the period asked for. ` +
        "A figure measured over what is left would be accurate and would be about a different fortnight, " +
        "which is worse than no figure — it is the roll-up that needs attention, not the fleet.",
    };
  }

  return { ...base, to: fuelThrough, partial: true, refusal: null };
}

/**
 * The sentence a surface puts beside a PARTIAL figure — one wording, because two surfaces phrasing
 * this differently is the same defect one layer down (the argument `FLEET_MILES_SOURCE_LABEL` makes).
 *
 * Null when the period is not partial, so a caller can render it unconditionally.
 */
export function fleetMpgWindowNote(w: {
  partial: boolean;
  to: Ymd;
  requestedTo: Ymd;
}): string | null {
  if (!w.partial) return null;
  return `Measured to ${w.to}, not ${w.requestedTo} — the daily fuel roll-up has not reached the end of this period yet.`;
}
