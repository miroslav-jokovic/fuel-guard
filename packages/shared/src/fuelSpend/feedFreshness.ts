/**
 * When the EFS feed last actually delivered, said in words (FUEL-T5, A7).
 *
 * ── WHY A PAGE OF FEED ROWS NEEDS THIS ─────────────────────────────────────────────────────────
 * Transactions and Rejections render `efs_transactions` and `declined_transactions` verbatim — they
 * are the vendor's own records, not our derivation of them. So the only way either page can be wrong
 * is by being INCOMPLETE, and a poller that stopped looks exactly like a quiet week: fewer rows, no
 * error, nothing on screen. The fuel-drop webhook that received nothing for six months was the same
 * failure in a different feed, and the fix there was the same one — say what you have heard, and when.
 *
 * ── ⚠ THE PLAN NAMED `*_last_polled_at`. THAT COLUMN WOULD LIE. ────────────────────────────────
 * `recordFeedFailure` stamps `posted_last_polled_at` **on failure too**, alongside the error text;
 * only `recordFeedSuccess` sets `*_last_success_at` and clears `*_last_error`. So a feed that has been
 * refused by EFS for two days still carries a poll stamp from three minutes ago, and a line built on
 * it would read "purchases last arrived 3 minutes ago" while nothing had arrived at all. That is the
 * confidently-wrong answer this whole step exists to remove, so the SUCCESS stamp is the source and
 * the poll stamp is used only to tell a third state apart from the other two.
 *
 * ── THREE STATES, BECAUSE THEY NEED THREE DIFFERENT ACTIONS ────────────────────────────────────
 *   • **never collected** — unconfigured. Waiting achieves nothing; somebody must turn it on.
 *   • **running but refused** — credentials, certificate or vendor outage. The poller is alive and
 *     failing, which no "last seen" timestamp alone can express.
 *   • **late** — nothing since several promised passes. Might resolve itself; worth watching.
 *
 * ── WHY THE THRESHOLD IS THE CADENCE AND NOT A ROUND NUMBER ────────────────────────────────────
 * Measured from `efsSoapPoller.ts`: the rejected feed polls every `EFS_SOAP_REJECTED_POLL_MINUTES`
 * (default 5) and the posted feed every `EFS_SOAP_POSTED_POLL_MINUTES` (default 15). "Late" is
 * therefore not an opinion — it is a multiple of the interval the poller promises. A fixed hour would
 * call the rejected feed healthy after twelve missed passes; a fixed ten minutes would call the posted
 * feed sick between two ordinary ones.
 */

/** How many missed passes before a feed is called late rather than merely between polls. */
export const FEED_LATE_AFTER_PASSES = 3;

export interface FeedState {
  /** When EFS last actually delivered — `*_last_success_at`, never the poll stamp. */
  lastSuccessAt: string | null;
  /** When we last TRIED. Set on failure too, which is why it cannot stand in for the above. */
  lastPolledAt: string | null;
  /** Error text from the most recent attempt; cleared on success. */
  lastError: string | null;
}

export interface FeedFreshness {
  feed: "posted" | "rejected";
  lastSuccessAt: string | null;
  /** Whole minutes since the last successful collection. Null when there has never been one. */
  ageMinutes: number | null;
  cadenceMinutes: number;
  /** Nothing has ever arrived, and nothing has ever been attempted. */
  neverCollected: boolean;
  /** The poller is running and EFS is refusing it — a state no timestamp alone can express. */
  failing: boolean;
  /** Nothing has arrived for more than `FEED_LATE_AFTER_PASSES` promised passes. */
  late: boolean;
  /** True for any of the three, so a surface can tone once rather than reason about which. */
  needsAttention: boolean;
  /** One sentence, plain word first, ending in what it means for the rows on screen. */
  lead: string;
}

const MIN_MS = 60_000;

const humanAge = (m: number): string => {
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
};

const FEED_NOUN = { posted: "Completed fuel purchases", rejected: "Declined card attempts" } as const;

const parse = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

export function describeFeedFreshness(
  feed: "posted" | "rejected",
  state: FeedState,
  cadenceMinutes: number,
  now: Date,
): FeedFreshness {
  const noun = FEED_NOUN[feed];
  const success = parse(state.lastSuccessAt);
  const polled = parse(state.lastPolledAt);
  const ageMinutes = success == null ? null : Math.max(0, Math.floor((now.getTime() - success) / MIN_MS));

  const base = {
    feed,
    lastSuccessAt: success == null ? null : new Date(success).toISOString(),
    ageMinutes,
    cadenceMinutes,
  };

  if (success == null && polled == null) {
    return {
      ...base, neverCollected: true, failing: false, late: false, needsAttention: true,
      lead: `${noun} have never been collected from EFS, so this list is empty rather than quiet.`,
    };
  }

  // An error on the most recent attempt outranks age: a feed refused two minutes ago is not "fresh",
  // and one refused for a week is not merely "late" — somebody has to fix a credential, not wait.
  if (state.lastError) {
    return {
      ...base, neverCollected: false, failing: true, late: false, needsAttention: true,
      lead:
        success == null
          ? `EFS is refusing this feed, and nothing has ever been collected — this list is empty because of the error, not because there is nothing to show.`
          : `EFS is refusing this feed. Nothing has arrived since ${humanAge(ageMinutes!)}, so anything after that is missing from this list rather than absent from the fleet.`,
    };
  }

  // Polled, no error, but no success ever recorded: the vendor answered and had nothing to give.
  if (success == null) {
    return {
      ...base, neverCollected: false, failing: false, late: false, needsAttention: false,
      lead: `${noun} are being collected from EFS, which has not sent any yet.`,
    };
  }

  const late = ageMinutes! > cadenceMinutes * FEED_LATE_AFTER_PASSES;
  return {
    ...base, neverCollected: false, failing: false, late, needsAttention: late,
    lead: late
      ? `${noun} last arrived ${humanAge(ageMinutes!)}, and normally arrive every ${cadenceMinutes} minutes — anything since then is missing from this list rather than absent from the fleet.`
      : `${noun} last arrived ${humanAge(ageMinutes!)}.`,
  };
}
