/**
 * How long each clock of the card mirror may go unmoved before it is stale — ONE definition, read by
 * the card routes (the page's "Checked …" line) and by the status poll (which marks a card WEX stopped
 * listing once it has been unseen this long). Moved here from `routes/read.ts` when the poll became
 * its second reader (2026-10-28): two copies of "stale" would let the page warn about a card the poll
 * does not yet treat as gone, or the reverse.
 */

/**
 * When the browser should start calling this mirror stale.
 *
 * Derived from the sweep cadence rather than fixed, because the two are the same question. The page
 * used to assume sixty minutes while the sweep runs daily, so it spent twenty-three hours a day
 * telling an operator that a perfectly current page needed refreshing. One sweep plus two hours of
 * grace: late enough that a working system is quiet, early enough that a sweep which did not run is
 * visible before the next one is due.
 */
export const detailStaleAfterMinutes = (env: { EFS_CARD_SYNC_HOURS: number }): number =>
  Math.round(env.EFS_CARD_SYNC_HOURS * 60) + 120;

/**
 * The same question for the ROSTER clock (`synced_at`), which the status poll now moves every few
 * minutes (EFS audit, 2026-09-30). Three missed polls, never under fifteen minutes. Until the poll
 * existed both clocks moved daily and one threshold served both — which is how a card's status could
 * be 25 hours old and still drawn as current. With the poll off (0), the roster is daily again.
 */
export const staleAfterMinutes = (env: { EFS_CARD_SYNC_HOURS: number; EFS_CARD_STATUS_POLL_MINUTES: number }): number =>
  env.EFS_CARD_STATUS_POLL_MINUTES > 0
    ? Math.max(15, 3 * env.EFS_CARD_STATUS_POLL_MINUTES)
    : detailStaleAfterMinutes(env);
