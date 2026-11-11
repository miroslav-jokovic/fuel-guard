import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MODEL_PRICES,
  ASSISTANT_MONTHLY_CAP_MICRO_USD,
  assistantBudgetVerdict,
  assistantCapCrossings,
  requestCostMicroUsd,
} from "./assistantUsage.js";
import { AI_MODELS } from "./ai.js";

/** Ask AI's cost and budget rules (F21 R2, Q-AI1). */
const PRICE = ASSISTANT_MODEL_PRICES[AI_MODELS.assistant];

describe("requestCostMicroUsd — Haiku 5.5 list prices", () => {
  it("prices each token kind at its own rate: $0.10 in, $0.50 out, cache read 0.1×, cache write 1.25×", () => {
    // 100K uncached input (the standard card's last prompt size) = $0.01 = 10,000 µ$.
    expect(requestCostMicroUsd(PRICE, { input_tokens: 100_000, output_tokens: 0 })).toBeCloseTo(10_000, 6);
    expect(requestCostMicroUsd(PRICE, { input_tokens: 2_000, output_tokens: 1_000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 4_000 }))
      .toBeCloseTo(2_000 * 0.1 + 1_000 * 0.5 + 10_000 * 0.01 + 4_000 * 0.125, 6);
  });

  it("bills the WHOLE request on the long card once the prompt passes 100K tokens, counting cached tokens", () => {
    const at = (input: number, read: number) => requestCostMicroUsd(PRICE, { input_tokens: input, output_tokens: 100, cache_read_input_tokens: read });
    expect(at(50_000, 50_000)).toBeCloseTo(50_000 * 0.1 + 50_000 * 0.01 + 100 * 0.5, 6);
    expect(at(50_000, 50_001)).toBeCloseTo(50_000 * 0.5 + 50_001 * 0.05 + 100 * 2.5, 6);
  });

  it("treats null cache counts as zero", () => {
    expect(requestCostMicroUsd(PRICE, { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: null, cache_creation_input_tokens: null })).toBeCloseTo(6, 6);
  });
});

describe("assistantBudgetVerdict", () => {
  it("is open under the $50 cap with no token limit set, and closes at the cap", () => {
    expect(assistantBudgetVerdict({ spentMicroUsd: ASSISTANT_MONTHLY_CAP_MICRO_USD - 1, orgTokensUsed: 9e9, orgTokenBudget: null }))
      .toEqual({ open: true, spentMicroUsd: ASSISTANT_MONTHLY_CAP_MICRO_USD - 1, capMicroUsd: 50_000_000 });
    expect(assistantBudgetVerdict({ spentMicroUsd: ASSISTANT_MONTHLY_CAP_MICRO_USD, orgTokensUsed: 0, orgTokenBudget: null }))
      .toMatchObject({ open: false, reason: "assistant_cap" });
  });

  it("honours the carrier's own token limit, and names it first when both are reached", () => {
    expect(assistantBudgetVerdict({ spentMicroUsd: 0, orgTokensUsed: 999, orgTokenBudget: 1000 }).open).toBe(true);
    expect(assistantBudgetVerdict({ spentMicroUsd: 0, orgTokensUsed: 1000, orgTokenBudget: 1000 })).toMatchObject({ open: false, reason: "org_token_limit" });
    expect(assistantBudgetVerdict({ spentMicroUsd: 9e9, orgTokensUsed: 1000, orgTokenBudget: 1000 })).toMatchObject({ reason: "org_token_limit" });
  });
});

describe("assistantCapCrossings", () => {
  const M = 1_000_000;
  it("rings 80% on the answer that crosses $40, and 100% on the one that crosses $50 — once each", () => {
    expect(assistantCapCrossings(39.99 * M, 40 * M)).toEqual(["warn"]);
    expect(assistantCapCrossings(40 * M, 41 * M)).toEqual([]);
    expect(assistantCapCrossings(49.9 * M, 50 * M)).toEqual(["reached"]);
    expect(assistantCapCrossings(50 * M, 51 * M)).toEqual([]);
    expect(assistantCapCrossings(10 * M, 11 * M)).toEqual([]);
  });
  it("one expensive answer can cross both lines", () => {
    expect(assistantCapCrossings(39 * M, 52 * M)).toEqual(["warn", "reached"]);
  });
});
