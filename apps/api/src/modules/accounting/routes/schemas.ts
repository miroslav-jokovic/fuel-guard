import { z } from "zod";
import { DEADHEAD_TREATMENTS } from "@silvicom/shared";

/**
 * Query parsing for the accounting surface, kept out of the router so it can be tested as the
 * contract it is. Both rules below were defects found on 2026-08-28 while auditing the cost-per-mile
 * page's filters; neither could fail loudly, which is why both survived review.
 */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

/**
 * A query-string flag, read strictly.
 *
 * `z.coerce.boolean()` is `Boolean(value)` applied to a STRING, so "0", "false" and "no" all parsed
 * as TRUE. `?includeOwnerOperators=false` therefore switched the owner-operator pool ON — the exact
 * opposite of what it says, and a change that moves every figure on the report. The web app only
 * ever sends the flag when it means true, so nothing shipped wrong; the URL is a supported entry
 * point for an accountant, and a flag that inverts itself there is a defect either way.
 *
 * An unrecognised value is rejected rather than guessed. A typo'd flag should be a 400, not a
 * silent false that quietly answers a different question.
 */
export const queryFlag = z
  .enum(["1", "0", "true", "false", "yes", "no"])
  .transform((v) => v === "1" || v === "true" || v === "yes");

const ORDER_MESSAGE = { message: "`from` must be before `to` (`to` is exclusive)." };
const ordered = (w: { from?: string; to?: string }) => !w.from || !w.to || w.from < w.to;

export const windowShape = z.object({ from: isoDay, to: isoDay });

/**
 * A reporting window. `to` is EXCLUSIVE — every reader behind this router windows on
 * `.gte(from).lt(to)` — so `from` must be strictly before it; `from === to` selects nothing.
 *
 * Without the ordering check an inverted or empty range was a perfectly valid request that returned
 * an empty result set, and the pages rendered their "nothing here yet" empty state — visually
 * identical to a window whose McLeod sweeps genuinely have not run. One of those is the reader's
 * typo and one is an operational gap, and the page could not tell them apart.
 */
export const windowSchema = windowShape.refine(ordered, ORDER_MESSAGE);

/**
 * The trend window (G9): a date, and how many whole months of history to end there.
 *
 * `to` alone rather than a range, because the series is a fixed count of whole months back from the
 * period on screen — a `from` would be a second way to say the same thing and a first way for the
 * two to disagree. The ceiling is two years: the ledger is swept from 2025-12 and a chart nobody
 * can read the labels on is not a longer answer, it is a slower one.
 */
export const trendSchema = z.object({
  to: isoDay,
  months: z.coerce.number().int().min(2).max(24).optional(),
});

export const cpmQuerySchema = windowShape
  .extend({
    deadhead: z.enum(DEADHEAD_TREATMENTS).optional(),
    includeOwnerOperators: queryFlag.optional(),
  })
  .refine(ordered, ORDER_MESSAGE);

export const entriesSchema = z
  .object({
    from: isoDay.optional(),
    to: isoDay.optional(),
    q: z.string().max(80).optional(),
    category: z.string().max(30).optional(),
    direction: z.enum(["earning", "expense"]).optional(),
    vehicleId: z.string().uuid().optional(),
    driverId: z.string().uuid().optional(),
    all: queryFlag.optional(), // drill-down: include non-canonical + void rows
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine(ordered, ORDER_MESSAGE);
