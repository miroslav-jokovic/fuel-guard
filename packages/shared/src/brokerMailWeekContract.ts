import { z } from "zod";
import { recordId } from "./recordId.js";
import { BROKER_MAIL_MATCH_STATES, BROKER_MAIL_THREAD_STATES } from "./brokerMailContract.js";

/**
 * The measure-only week's report (BROKER-MAIL-READER-PLAN §8) — what the API sends Settings › Broker
 * mail › Measure week. The week ends in a go / change / stop ruling, and this is the evidence it is
 * ruled on: every §8 line, in numbers, from the envelope rows and the gateway's per-run counts.
 *
 * ── WHERE EACH NUMBER COMES FROM ───────────────────────────────────────────────────────────────
 *  · `broker_mail_messages` (kept 90 days): one row per EXTERNAL Inbox email of a read mailbox, so
 *    every per-mailbox figure is about external mail. Internal mail is never a row (D-BMR7).
 *  · `mail_gateway_cycles.counts` (kept 14 days): the gateway's own totals per run, for the whole
 *    company — messages read (Inbox and Sent Items), bodies opened, throttling, errors. They are not
 *    kept per mailbox, so "messages in" exists per day only. A week older than 14 days has rows but no
 *    run counts; the report says so instead of printing zeros.
 *
 * ── WHAT IS DERIVED, AND HOW ───────────────────────────────────────────────────────────────────
 *  · "Matched by the subject alone": a row whose matched reference is among the tokens the SHARED
 *    token rule (`brokerMailTokensIn`) finds in its stored subject. A match that needed the body is
 *    the rest of the `one` rows.
 *  · "Would have texted": the P3 tick's rule replayed on history with TODAY's settings — a row on the
 *    page's two open queues (one load matched, or a broker candidate) with no answer by the answer-by
 *    time. Night = that moment falls in the company's SMS quiet window. The dispatcher's text goes
 *    day and night (Q-BM11); a backup notice due at night waits for the window's end and leaves only
 *    if the email is still unanswered then (Q-BM12) — counted the same way.
 *  · "Follow-up on a new conversation" (D-BMR9): the same sender, the same matched load, in the same
 *    mailbox, on more than one conversation in the range — Outlook split one thread, so each extra
 *    conversation restarted the clock.
 *  · The first pass mark: of the broker candidates (D-BMR6), the share tied to exactly one load.
 *    The second — at most 5 % of sampled `waiting` rows wrong — is a person's check against Outlook;
 *    the report gives the 50 rows, picked the same way every time for the same range.
 */

export const BROKER_MAIL_WEEK_DAYS = 7;
/** Proposed in §8: ≥ 70 % of broker update threads tied to exactly one load. */
export const BROKER_MAIL_WEEK_MATCH_PASS = 0.7;
/** Proposed in §8: ≤ 5 % of sampled waiting rows wrong (checked by hand). */
export const BROKER_MAIL_WEEK_WRONG_PASS = 0.05;
export const BROKER_MAIL_WEEK_SAMPLE = 50;
/** Sender domains listed under "no reference in the subject". */
export const BROKER_MAIL_WEEK_TOP_DOMAINS = 15;

const id = recordId();
const n = z.number().int().nonnegative();

/** One group's figures — a day, a mailbox, or the whole range. */
export const brokerMailWeekStatsSchema = z.object({
  external: n,
  candidates: n,
  bodiesRead: n,
  match: z.object({ one: n, several: n, none: n, not_tried: n }),
  /** Of `match.one`: tied by the subject alone (the rest needed the body). */
  oneBySubject: n,
  /** Of `match.one`: the load's McLeod dispatcher is the mailbox's owner. */
  oneOwnersLoad: n,
  /** Arrived through a list or a shared address, not addressed to the mailbox (Q-BMR4). */
  viaList: n,
  answeredByOwner: n,
  answeredByColleague: n,
  stillWaiting: n,
  /** Minutes from arrival to the first answer, over the answered rows; null with none. */
  replyMinutesMedian: z.number().nullable(),
  replyMinutesP90: z.number().nullable(),
  /** P3 replayed with today's settings. */
  wouldText: z.object({ dispatcherDay: n, dispatcherNight: n, backupDay: n, backupHeldToMorning: n }),
  followUpNewConversation: n,
});
export type BrokerMailWeekStats = z.infer<typeof brokerMailWeekStatsSchema>;

/** The gateway's own run totals for a day (company-wide; `mail_gateway_cycles`, kept 14 days). */
export const brokerMailWeekRunsSchema = z.object({
  runs: n,
  /** Runs one a minute would have made in the part of the day that has passed. */
  runsExpected: n,
  messagesRead: n,
  bodiesRead: n,
  throttled: n,
  errors: n,
});

export const brokerMailWeekSchema = z.object({
  from: z.string(),
  to: z.string(),
  zone: z.string(),
  /** The settings the "would have texted" lines were replayed with. */
  settings: z.object({ answerWithinMinutes: n, backupAfterMinutes: n }),
  /** False when the range starts more than 14 days ago: run counts are gone, rows remain. */
  runCountsKept: z.boolean(),
  total: brokerMailWeekStatsSchema,
  days: z.array(z.object({ day: z.string(), stats: brokerMailWeekStatsSchema, runs: brokerMailWeekRunsSchema.nullable() })),
  mailboxes: z.array(z.object({ userId: id, name: z.string(), stats: brokerMailWeekStatsSchema })),
  noReferenceDomains: z.array(z.object({ domain: z.string(), emails: n })),
  passMarks: z.object({
    /** match.one / candidates; null with no candidates. */
    matchedOneShare: z.number().nullable(),
    matchedOnePass: z.boolean().nullable(),
  }),
  /** For the hand check against Outlook: rows that were `waiting` at some point, a fixed pick per range. */
  sample: z.array(z.object({
    id,
    ownerName: z.string(),
    receivedAt: z.string(),
    fromAddress: z.string().nullable(),
    subject: z.string().nullable(),
    matchState: z.enum(BROKER_MAIL_MATCH_STATES),
    loadRef: z.string().nullable(),
    threadState: z.enum(BROKER_MAIL_THREAD_STATES),
    answeredAt: z.string().nullable(),
  })),
});
export type BrokerMailWeek = z.infer<typeof brokerMailWeekSchema>;
