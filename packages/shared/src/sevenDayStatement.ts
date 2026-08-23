import { z } from "zod";

/**
 * The §395.8(j)(2) seven-day work statement (P7, D-PKT7, migration 0236).
 *
 * ── WHAT THE REGULATION ASKS FOR ──────────────────────────────────────────────────────────────
 * When a carrier uses a driver for the first time or intermittently, it must obtain from that driver
 * a signed statement giving the total time on duty during the **seven days preceding the day they
 * begin work**, and the date and time they were **last relieved from duty**. The purpose is
 * arithmetic: §395.3's 60/70-hour limits are cumulative, so a carrier that does not know what a new
 * driver already worked cannot know what they may lawfully work today.
 *
 * ── WHY IT IS NOT PART OF THE APPLICATION ─────────────────────────────────────────────────────
 * Because its answer expires. The seven days it names are the seven before work BEGINS, so a
 * statement collected during an application describes the wrong week by the time anybody is hired.
 * The owner moved it to the hire on 2026-08-23; the packet page it comes from (21) left the
 * application PDF with it.
 */

/** One day of the seven: the date, and the hours on duty that day. */
export const sevenDayEntrySchema = z.object({
  /** The calendar day, so a reader never has to count backwards to know which day a number is. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  /**
   * Total time on duty, in hours.
   *
   * ⚠ Capped at 24 rather than at some "reasonable" figure, and allowed to be fractional: §395.8's
   * grid is quarter-hours, a driver can be on duty for 23.75 of a day, and a validator that refused
   * an unusual-but-lawful answer would push somebody into rounding their record.
   */
  hours: z.coerce.number().min(0).max(24),
});
export type SevenDayEntry = z.infer<typeof sevenDayEntrySchema>;

export const SEVEN_DAY_LENGTH = 7;

export const sevenDayStatementCreateSchema = z.object({
  driver_id: z.uuid(),
  /** The day the statement is made — the packet's "Today's date". */
  statement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  /**
   * Exactly seven, oldest first.
   *
   * ⚠ Fixed length in the contract AND in the database (0236's `seven_day_statements_days_shape`).
   * The regulation does not have a five-day version, and a partial statement is not a lenient one —
   * it is an arithmetic base with a hole in it, which is worse than none because it looks complete.
   */
  days: z.array(sevenDayEntrySchema).length(SEVEN_DAY_LENGTH),
  /** §395.8(j)(2)'s second half. */
  last_relieved_at: z.string().min(1),
  /** The driver's own name as they signed it — transcribed by the office, never typed for them. */
  signed_name: z.string().min(1).max(200),
  signed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
});
export type SevenDayStatementCreate = z.infer<typeof sevenDayStatementCreateSchema>;

export interface SevenDayStatement {
  id: string;
  driver_id: string;
  statement_date: string;
  days: SevenDayEntry[];
  last_relieved_at: string;
  signed_name: string;
  signed_on: string;
  created_at: string;
}

/** Total hours across the seven days — what §395.3's 60/70-hour limits are measured against. */
export const sevenDayTotal = (days: readonly SevenDayEntry[]): number =>
  Math.round(days.reduce((sum, d) => sum + d.hours, 0) * 100) / 100;

/**
 * The seven dates a statement made on `statementDate` must cover: the seven days PRECEDING it,
 * oldest first.
 *
 * ⚠ It does not include the statement's own day, and that is the regulation's wording rather than an
 * off-by-one: §395.8(j)(2) asks for the seven days *preceding* the day the driver begins work. A
 * driver signing on the 8th is accounting for the 1st through the 7th.
 *
 * Pure and UTC-based on purpose — a helper that read the local clock would give two different answers
 * either side of midnight, and this feeds a legal record.
 */
export function sevenDayWindow(statementDate: string): string[] {
  const end = new Date(`${statementDate}T00:00:00Z`);
  return Array.from({ length: SEVEN_DAY_LENGTH }, (_v, i) => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - (SEVEN_DAY_LENGTH - i));
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Does this statement cover the right seven days?
 *
 * Returned as the offending dates rather than a boolean, so a caller can say WHICH day is wrong. A
 * statement whose dates drifted is not a validation nicety: the hours are summed against a window,
 * and a window that is not the regulation's window produces a lawful-looking number that is not.
 */
export function sevenDayWindowMismatch(input: {
  statement_date: string;
  days: readonly SevenDayEntry[];
}): { expected: string[]; got: string[] } | null {
  const expected = sevenDayWindow(input.statement_date);
  const got = input.days.map((d) => d.date);
  const same = expected.length === got.length && expected.every((d, i) => d === got[i]);
  return same ? null : { expected, got };
}
