import { AI_MODELS } from "./ai.js";

/**
 * What one Ask AI answer cost, and whether the carrier may ask another this month (F21 R2, PLAN.md
 * Step 1a/1b). Pure, so the API's gate and anything that later shows "spent this month" read one rule.
 *
 * ── WHY A DOLLAR CAP AND NOT ONLY THE TOKEN LIMIT ──────────────────────────────────────────────
 * The carrier already has a "Monthly AI usage limit, in tokens" (`anomaly_thresholds`
 * .ai_monthly_token_budget, Thresholds page) compared with `org_usage_month`, the one org-wide counter
 * every AI spender adds to (0130, 0451, 0549). The assistant honours it — a limit the screen offers and
 * nothing enforces is a promise broken quietly (AUDIT P2). But tokens are not money once prompt
 * caching exists: a cache read is a tenth of an input token's price, so a token limit over-counts a
 * cached assistant ten to one. The owner's cap (Q-AI1, 2026-11-10) is in dollars, $50 per carrier per
 * month, and is measured on the assistant's own ledger (`ai_assistant_usage`, 0584) at list price.
 */

/** List prices in micro-dollars per million tokens, per request's prompt-length card. */
export interface ModelPriceCard {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache write (1.25× input). The assistant writes no 1-hour entries. */
  cacheWrite: number;
}
export interface ModelPrice {
  /** Prompts of at most `longPromptFrom - 1` tokens. */
  standard: ModelPriceCard;
  /** Haiku 5.5 bills a request whose prompt passes 100K tokens on a second card, the whole request. */
  long: ModelPriceCard;
  longPromptFrom: number;
}

/**
 * Anthropic list prices, read 2026-11-10: Claude Haiku 5.5 $0.10 / $0.50 per MTok up to 100K prompt
 * tokens and $0.50 / $2.50 beyond; cache reads 0.1× input, 5-minute writes 1.25×. An estimate of the
 * invoice, not the invoice — volume discounts or a price change would move it, which is why the cap
 * has headroom and the ledger keeps the token counts the dollars were computed from.
 */
export const ASSISTANT_MODEL_PRICES: Record<(typeof AI_MODELS)["assistant"], ModelPrice> = {
  "claude-haiku-5-5": {
    standard: { input: 100_000, output: 500_000, cacheRead: 10_000, cacheWrite: 125_000 },
    long: { input: 500_000, output: 2_500_000, cacheRead: 50_000, cacheWrite: 625_000 },
    longPromptFrom: 100_001,
  },
};

/** One model request's `usage`, as the SDK reports it (nulls are zeros). */
export interface RequestUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Micro-dollars for one request — whole, because the prompt-length card applies to the whole request. */
export function requestCostMicroUsd(price: ModelPrice, u: RequestUsage): number {
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const prompt = u.input_tokens + read + write;
  const card = prompt >= price.longPromptFrom ? price.long : price.standard;
  return (u.input_tokens * card.input + read * card.cacheRead + write * card.cacheWrite + u.output_tokens * card.output) / 1_000_000;
}

/** The owner's cap (Q-AI1): $50 per carrier per calendar month on the carrier's clock. */
export const ASSISTANT_MONTHLY_CAP_MICRO_USD = 50_000_000;
/** The share of the cap at which an admin is told (Q-AI1's "alert at 80%"). */
export const ASSISTANT_CAP_ALERT_SHARE = 0.8;

export type AssistantBudgetVerdict =
  | { open: true; spentMicroUsd: number; capMicroUsd: number }
  | { open: false; reason: "assistant_cap" | "org_token_limit"; message: string };

/**
 * May the carrier ask another question? `orgTokenBudget` null = no token limit set (`withinBudget`'s
 * convention). Checked BEFORE an answer, so one answer may cross the line — a question is never cut
 * off half-answered, and one answer is cents.
 */
export function assistantBudgetVerdict(state: {
  spentMicroUsd: number;
  orgTokensUsed: number;
  orgTokenBudget: number | null;
  capMicroUsd?: number;
}): AssistantBudgetVerdict {
  const cap = state.capMicroUsd ?? ASSISTANT_MONTHLY_CAP_MICRO_USD;
  if (state.orgTokenBudget != null && state.orgTokensUsed >= state.orgTokenBudget) {
    return {
      open: false,
      reason: "org_token_limit",
      message: "This month's AI usage limit is used up (Settings → Thresholds). An admin can raise it, or it resets on the 1st.",
    };
  }
  if (state.spentMicroUsd >= cap) {
    return {
      open: false,
      reason: "assistant_cap",
      message: "Ask AI has reached this month's spending cap. It resets on the 1st.",
    };
  }
  return { open: true, spentMicroUsd: state.spentMicroUsd, capMicroUsd: cap };
}

/**
 * The cap lines one answer carried this month's spend across (F21 R2b): `warn` at 80% (Q-AI1's admin
 * alert), `reached` at 100% — the answer after which Ask AI stops answering. Crossing, not "is above",
 * so each line rings on the answer that crossed it; the sender's dedupe key, per carrier per month, is
 * what stops two answers crossing together from ringing twice.
 */
export function assistantCapCrossings(beforeMicroUsd: number, afterMicroUsd: number, capMicroUsd = ASSISTANT_MONTHLY_CAP_MICRO_USD): Array<"warn" | "reached"> {
  const out: Array<"warn" | "reached"> = [];
  const warnAt = capMicroUsd * ASSISTANT_CAP_ALERT_SHARE;
  if (beforeMicroUsd < warnAt && afterMicroUsd >= warnAt) out.push("warn");
  if (beforeMicroUsd < capMicroUsd && afterMicroUsd >= capMicroUsd) out.push("reached");
  return out;
}
