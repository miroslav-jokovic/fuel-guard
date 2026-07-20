/**
 * Anomaly rule identifiers, labels, and suppression list.
 *
 * The DATA — RULE_IDS / RuleId / RULE_LABELS / SUPPRESSED_RULE_IDS — is GENERATED from catalog.yaml
 * (the single source of truth). Edit catalog.yaml and run `pnpm gen:rules`; never hand-edit the
 * generated constants. Only formatRuleId (logic) is authored here.
 *
 * SUPPRESSED_RULE_IDS are data-quality flags, NOT theft/misuse signals — gaps in the source data (a fill
 * not matched to a vehicle/driver, or a blank odometer) rather than suspicious behavior. Flagging them
 * would drown the real signals, so by product decision they never raise an anomaly; the underlying facts
 * stay visible on the transaction (e.g. "Unattributed" in the fuel log). Re-enable by flipping
 * `suppressed` in catalog.yaml.
 */
import { RULE_IDS, RULE_LABELS, SUPPRESSED_RULE_IDS } from "./catalog.generated.js";
import type { RuleId } from "./catalog.generated.js";

export { RULE_IDS, RULE_LABELS, SUPPRESSED_RULE_IDS };
export type { RuleId };

/** Returns the human-friendly label for a rule ID, with a sensible fallback for unknown IDs. */
export function formatRuleId(ruleId: string): string {
  if (ruleId === "theft_case") return "Theft Risk";
  return (RULE_LABELS as Record<string, string>)[ruleId]
    ?? ruleId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


