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
/**
 * ── HISTORY ──────────────────────────────────────────────────────────────────────────────────────
 * **2 (2026-09-05)** — `expected_odometer_band` stopped assuming the tank starts empty. Its ceiling
 * gained the one-full-tank allowance `cumulative_overfuel` already grants, and it now suppresses
 * itself on a truck with no capacity source. Measured across 14,498 production fills, that is 430
 * fires down to 22 — every one of the 408 an accusation the old ceiling made because the truck had
 * bought less than it drove, which is what a partial fill looks like. The bump is what carries the
 * correction to the fills already judged; without it the nightly's trailing window would reach two
 * weeks of them and the rest of history would keep the old verdict.
 *
 * **3 (2026-09-06)** — `cumulative_overfuel` reweighted 75 → 0 (owner ruling on the re-asked
 * Q-FUI11). It was above the 60 at which a signal accuses unaccompanied and carried 64 of the queue's
 * 95 false positives; 52 of its 67 cases were a lone signal and 51 of those were dispositioned false.
 * The bump is what retires those cases: a weight change alters what scoring CONCLUDES from unchanged
 * inputs, which is this file's own trigger, and without it 64 accusations stay on the queue wearing a
 * verdict the product no longer makes.
 *
 * ⚠ It restarts the version-2 sweep, which was 36% converged. That is the cost of two derivation
 * changes a day apart and it is accepted rather than worked around: a partially-converged fleet
 * judged by two different rulesets is worse than one that takes another eight nights to agree.
 *
 * **4 (2026-10-08)** — CF5 (D-CF3/D-CF4): every approved-fill rule but `tank_fill_short` and
 * `tank_chronic_short` reweighted to 0, so it is a note and never a case. Over the 60 days to
 * 2026-10-08 the engine raised 10 alerts and 18 reviews; under these weights the same fired signals
 * make 0 alerts and 6 reviews, every one carrying `tank_fill_short`. A new fill is judged by these weights
 * when it is imported. History reaches them only through this bump: the nightly sweep re-scores 2,000 fills
 * a night, oldest first, so production's 18,062 take about ten nights and the newest come last. The boot
 * rebuild does not help: `REBUILD_ON_BOOT` is false on production (checked 2026-10-08), and this text said
 * otherwise for a few hours on the day the bump was merged.
 *
 * It ships AFTER the reset (Q-F9 (a); 0441, released 2026-10-08 15:28 UTC), so it closes nothing old:
 * every case before the start date is already closed, and re-scoring touches only OPEN cases — one that
 * still has a tank signal is lowered to a review, any other is superseded. Measured at 15:46 UTC that
 * day: 0 cases opened since the reset.
 */
export const SCORING_VERSION = 4;
