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

// ── Higgsfield renders, in US dollars (C3; D-AD13; Q-APX16 (a)) ────────────────────────────────────
/**
 * A render's money is counted in hundredths of a cent — a ten-thousandth of a dollar, the precision of
 * `ad_generations.cost_units` (numeric(14, 4), 0634) — as WHOLE numbers, so a month's sum is exact. Higgsfield's
 * `/estimate` answers a decimal string (`"0.094"`); it is read digit by digit, never through a float, and a price
 * finer than a hundredth of a cent is rounded UP, so the month can only overstate what was spent.
 */
export const USD_TICKS_PER_CENT = 100;
export const USD_TICKS_PER_DOLLAR = 10_000;

/** `"0.094"` → 940; `"1"` → 10000; `"0.00001"` → 1 (rounded up). Anything that is not a plain amount → null. */
export function usdTicks(usd: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d+))?$/.exec(usd.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  const kept = Number((frac + "0000").slice(0, 4));
  const roundUp = /[1-9]/.test(frac.slice(4)) ? 1 : 0;
  return Number(m[1]) * USD_TICKS_PER_DOLLAR + kept + roundUp;
}

/** Ticks as the ledger writes them: dollars to four places, as a string PostgREST hands to `numeric` unchanged. */
export const ticksAsDollars = (ticks: number): string => `${Math.floor(ticks / USD_TICKS_PER_DOLLAR)}.${String(ticks % USD_TICKS_PER_DOLLAR).padStart(4, "0")}`;

export type RenderGateRefusal = AiGateRefusal | "price_unknown";

/**
 * May `agent` submit a render whose estimate is `priceTicks` now? The anthropic gate's rules (switch, then a
 * null budget refuses) with one difference: the test is "used + price ≤ budget", not "used < budget". A
 * render's price is asked before it is made (a token count is not), and `used` counts renders still in
 * flight at their price (`higgsfieldTicksThisMonth`), so the month cannot overshoot at all. A null price is
 * an estimate that could not be read — refused, never guessed.
 */
export function renderGate(settings: AdsSettings, agent: AdAiAgent, usedTicks: number, priceTicks: number | null): { open: true } | { open: false; refusal: RenderGateRefusal } {
  if (settings.budgets.agents_enabled[agent] !== true) return { open: false, refusal: "agent_off" };
  if (priceTicks == null) return { open: false, refusal: "price_unknown" };
  const budget = settings.budgets.higgsfield_usd_cents_monthly;
  if (budget == null) return { open: false, refusal: "budget_unset" };
  if (usedTicks + priceTicks > budget * USD_TICKS_PER_CENT) return { open: false, refusal: "budget_spent" };
  return { open: true };
}
