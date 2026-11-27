/**
 * followups — the warning desk (docs/plans/maintenance/WARNING-DESK-PLAN.md, D-WD6). A harness module:
 * owns `follow_up_rules`, `follow_ups` and `follow_up_actions` (0653), and turns the Samsara collector's
 * warnings into one follow-up per repeating problem that a person in Maintenance works.
 *
 * It reads warnings only through `modules/samsara`'s exported reads — handed in by
 * `orchestration/warningDesk.ts` for the tick, imported from samsara's index by its routes — and the
 * roster only through `readSamsaraSubjects`; never another module's table (docs/ARCHITECTURE.md D-ARC3).
 */
export { evaluateFollowUps, type EvaluateResult, type EvaluatedWarning, type WarningReaders } from "./evaluate.js";
export { readRuleOverrides, saveRuleOverride, clearRuleOverride } from "./rules.js";
export { followUpsRouter } from "./routes/index.js";
// The urgent bell names the follow-ups it rings for (WD6, orchestration/warningDeskBell.ts).
export { readFollowUpsByIds, type FollowUpRow } from "./lines.js";
