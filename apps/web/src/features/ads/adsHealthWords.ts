import type { AdsHealthAgent, HealthTone } from "@silvicom/shared";
import { count } from "./spendLines";

/** The Automation tab's figures in words (V8 health read). Pure; the figures are the API's (`AdsHealthView`). */
export const HEALTH_TONE: Record<HealthTone, string> = {
  ok: "text-ink", warn: "text-warning-700", bad: "text-danger-700", unknown: "text-ink-muted",
};

/** In-shape answers as a share of the calls that reached the model; "—" when none did (budget refusals asked nothing). */
export function agentShare(a: Pick<AdsHealthAgent, "in_shape_share" | "in_shape" | "failed">): string {
  if (a.in_shape_share === null) return "—";
  return `${Math.round(a.in_shape_share * 100)}% (${count(a.in_shape)} of ${count(a.in_shape + a.failed)})`;
}

/** Units in the ledger's own unit — tokens for Claude, credits for Higgsfield; never converted. */
export function agentUnits(a: Pick<AdsHealthAgent, "cost_units" | "cost_unit">): string {
  if (a.cost_unit === null) return a.cost_units === 0 ? "—" : count(a.cost_units);
  return `${count(a.cost_units)} ${a.cost_unit}`;
}
