/**
 * Which generation of the scoring logic judged a fill.
 *
 * WHY THIS EXISTS. A derivation change only reaches the fills that get re-scored, and until 2026-09-05
 * nothing recorded which fills had been judged under which rules. That left two options and no third:
 * `nightlyReconcile` re-scores a trailing `RECENT_REBUILD_DAYS` (14) window, so anything older kept its
 * old verdict forever (Q-FUI9); or re-score all of history, which was measured at THREE HOURS for
 * 15,972 fills and had to be cancelled at 14,400 to get the day back.
 *
 * The stamp turns that into a queue. The nightly sweep takes a bounded batch of the fills stamped below
 * this number, oldest first, so history converges over several nights on its own and the backlog is a
 * figure anyone can read — `count(*) where scoring_version < SCORING_VERSION`.
 *
 * WHEN TO BUMP. Increment this when a change alters what scoring CONCLUDES from unchanged inputs: a
 * rule's threshold or gate, a learner's output, a derived field the rules read (miles, MPG, window
 * span), or a new rule. Do NOT bump for a change that only affects which INPUTS are collected — a fill
 * whose telematics arrives later is already re-scored by the recon path, and bumping for it would queue
 * the whole fleet to no purpose.
 *
 * The cost of bumping is one sweep of history at the nightly batch size; the cost of forgetting is a
 * fleet still judged by the old rules, which is the failure this replaces. When in doubt, bump.
 */
export const SCORING_VERSION = 1;
