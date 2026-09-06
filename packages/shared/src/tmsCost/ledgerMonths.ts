/**
 * Whether a month's ledger is the whole month, or only as much of it as had happened when the
 * sweep ran (G11).
 *
 * **The failure this exists for, measured on production 2026-09-03.** The McLeod financial sweep
 * is run by hand behind the carrier's VPN, and the last run was 2026-08-28 — four days before
 * August ended. It therefore staged eleven August lines: a GPS fee, an Oregon permit and an MVR
 * charge, $8,430.00 of expense and **no revenue at all**. Nothing distinguished that from a
 * finished month, because the only test anything applied was "does this month have rows".
 *
 * The consequence was not subtle. The finance page opens on the last full calendar month, which on
 * 2026-09-03 is August, so the report said the fleet **earned $0.00, spent $8,430.00 and kept
 * −$8,430.00** — and the twelve-month trend drew a cliff to the axis on its final point. Every
 * figure was computed correctly from the rows that were there. That is the whole problem: a
 * plausible, precise, entirely wrong report, and it recurs every month between the 1st and the
 * next sweep rather than being a one-off state.
 *
 * **The rule is a comparison the rows already carry, never a date.** A month is complete when the
 * newest sweep that touched it ran after the month was over. `period_end` is McLeod's own
 * exclusive upper bound for the period (2026-09-01 for August), so the test is whether the sweep
 * is dated later than that — which keeps working for a sweep that stops for a fortnight next
 * spring, and says nothing about this particular rollout.
 *
 * **Why a whole day of margin.** `swept_at` is UTC and the carrier books in US local time, so a
 * sweep at 00:30 UTC on the 1st ran at 19:30 the previous evening where the entries are made and
 * would miss the tail of the month. Requiring the sweep to be dated strictly after `period_end`
 * covers every US timezone, and errs toward withholding a month rather than publishing a partial
 * one — which is the direction D-FIN10 requires.
 *
 * **What this rule does NOT claim.** It does not say the month is closed. McLeod keeps posting
 * accruals and adjustments to a month for days after it ends, and a sweep on the 2nd cannot hold
 * an entry booked on the 5th. Every figure is as of its sweep, which is why the sweep date travels
 * with the answer instead of being replaced by a badge that says "final".
 *
 * Pure. No clock, no I/O, and no constant that is a month or a threshold.
 */

/** One month of staged ledger, reduced to the two facts that decide whether it can be reported. */
export interface LedgerMonthInput {
  /** `YYYY-MM`. */
  month: string;
  /** McLeod's exclusive period upper bound, `YYYY-MM-DD` — 2026-09-01 for August. */
  periodEnd: string;
  /** The newest `swept_at` over the month's rows, or null when no sweep has landed any. */
  sweptAt: string | null;
}

export interface LedgerMonth {
  month: string;
  periodEnd: string;
  sweptAt: string | null;
  /** True when the newest sweep ran after the month was over. */
  complete: boolean;
  /**
   * How the month is short. `absent` — no sweep has staged a single row. `partial` — a sweep
   * staged rows while the month was still running, so what is there is real and is not all of it.
   * Null when the month is complete.
   */
  shortfall: "absent" | "partial" | null;
}

/** The day part of a timestamp, which is all the comparison against a period bound may use. */
const day = (stamp: string): string => stamp.slice(0, 10);

export function assessLedgerMonths(months: LedgerMonthInput[]): LedgerMonth[] {
  return months.map((m): LedgerMonth => {
    if (!m.sweptAt) {
      return { ...m, complete: false, shortfall: "absent" };
    }
    // Strictly after the exclusive period end: a sweep dated 2026-09-01 for August ran at some
    // point on the 1st, which is the previous evening in every US timezone.
    const complete = day(m.sweptAt) > m.periodEnd;
    return { ...m, complete, shortfall: complete ? null : "partial" };
  });
}

/**
 * What the page prints instead of the figures, for the months it cannot report.
 *
 * Written for a reader rather than a log, and it names the months: "some months are incomplete"
 * sends a reader looking for which. The two shortfalls get two sentences because they are two
 * different situations and the fix for each is different — one waits for a sweep, the other waits
 * for a re-sweep after month end.
 */
export function ledgerMonthsReason(months: LedgerMonth[]): string | null {
  const partial = months.filter((m) => m.shortfall === "partial");
  const absent = months.filter((m) => m.shortfall === "absent");
  const sentences: string[] = [];
  if (partial.length) {
    const named = partial.map((m) => `${m.month} (swept ${day(m.sweptAt!)})`).join(", ");
    sentences.push(
      `${named} ${partial.length === 1 ? "was" : "were"} swept before the month ended, so only part of the ledger is here — those figures are left out rather than reported short.`,
    );
  }
  if (absent.length) {
    sentences.push(
      `The McLeod sweep has not reached ${absent.map((m) => m.month).join(", ")} at all.`,
    );
  }
  return sentences.length ? sentences.join(" ") : null;
}
