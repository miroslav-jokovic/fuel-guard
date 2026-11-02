import type { AdAiAgent } from "./contracts.js";
import type { AdsSettings } from "./settingsContract.js";

/**
 * The ads AI rail's gate (ADS-AGENT-BUILD-WORKFLOW.md A4; D-AD13, D-RA9). Pure: the tokens already
 * used this month are an argument, read by the API from `ad_generations` in the carrier's month
 * (`adsReport.monthContext`), so the settings page's "AI credits used" and this gate read one fold.
 *
 * ── A NULL BUDGET REFUSES. `withinBudget` (ai.ts) MEANS THE OPPOSITE, ON PURPOSE ─────────────────
 * `withinBudget(used, null)` is true — "no budget set" is unlimited for the document reader and
 * hazmat, which predate any budget and must keep reading. The ads settings contract says the reverse
 * for every amount it holds: nothing is in force until an admin saves it (G5, `settingsContract.ts`),
 * because a default in code would be a spending decision nobody made. So a null
 * `anthropic_tokens_monthly` refuses every ads Claude call, and this file does not call
 * `withinBudget` — reusing it would quietly import its null.
 *
 * ── THE ORDER: SWITCH, THEN BUDGET ────────────────────────────────────────────────────────────────
 * A switched-off agent is refused whatever its budget says: nothing was asked of it, so the API
 * writes no `ad_generations` row. A budget refusal IS a row (`budget_exhausted`, D-AD13): the
 * worker asked, the month said no, and the settings page has to be able to show that it happened.
 *
 * ── HOW FAR A MONTH CAN OVERSHOOT ─────────────────────────────────────────────────────────────────
 * The check is "used < budget" before a call, as the document reader's is: the call that crosses the
 * line completes, and its tokens count. Calls running at once can each pass the same check, so the
 * overshoot is bounded by (calls in flight) × (one call's tokens) — `KIND_CAPS` (A6) bounds the first
 * factor and each worker's `maxTokens` the second. A row still `started` has no cost yet, so an
 * in-flight call is not counted until it completes; the same bound covers it.
 */

export type AiGateRefusal = "agent_off" | "budget_unset" | "budget_spent";

export type AiGateVerdict =
  | { open: true; tokens_left: number }
  | { open: false; refusal: AiGateRefusal };

/** Tokens left this month, or null when no budget is in force (which refuses — see the header). */
export function adsTokensLeft(usedTokens: number, monthlyBudget: number | null): number | null {
  if (monthlyBudget == null) return null;
  return Math.max(0, monthlyBudget - usedTokens);
}

/** May `agent` ask Claude now? Settings are the newest saved version (or `ADS_SETTINGS_UNSET`). */
export function aiGate(settings: AdsSettings, agent: AdAiAgent, usedTokens: number): AiGateVerdict {
  if (settings.budgets.agents_enabled[agent] !== true) return { open: false, refusal: "agent_off" };
  const left = adsTokensLeft(usedTokens, settings.budgets.anthropic_tokens_monthly);
  if (left === null) return { open: false, refusal: "budget_unset" };
  if (left <= 0) return { open: false, refusal: "budget_spent" };
  return { open: true, tokens_left: left };
}
