import type { AdsHealthAgent, HealthTone } from "@silvicom/shared";
import { count, usd } from "./spendLines";

/** The Automation tab's figures in words (V8 health read). Pure; the figures are the API's (`AdsHealthView`). */
export const HEALTH_TONE: Record<HealthTone, string> = {
  ok: "text-ink", warn: "text-warning-700", bad: "text-danger-700", unknown: "text-ink-muted",
};

/** In-shape answers as a share of the calls that reached the model; "—" when none did (budget refusals asked nothing). */
export function agentShare(a: Pick<AdsHealthAgent, "in_shape_share" | "in_shape" | "failed">): string {
  if (a.in_shape_share === null) return "—";
  return `${Math.round(a.in_shape_share * 100)}% (${count(a.in_shape)} of ${count(a.in_shape + a.failed)})`;
}

/**
 * Units in the ledger's own unit, never converted: tokens for Claude; dollars for Higgsfield since Q-APX16, to the
 * cent, a fraction rounded UP as the spend card does (a month only ever overstates); credits on rows written before.
 */
export function agentUnits(a: Pick<AdsHealthAgent, "cost_units" | "cost_unit">): string {
  if (a.cost_unit === null) return a.cost_units === 0 ? "—" : count(a.cost_units);
  if (a.cost_unit === "usd") return usd(Math.ceil(Math.round(a.cost_units * 10_000) / 100));
  return `${count(a.cost_units)} ${a.cost_unit}`;
}
