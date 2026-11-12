import { describe, expect, it } from "vitest";
import { ASSISTANT_ANSWER_MAX, ASSISTANT_HISTORY_CHARS, ASSISTANT_HISTORY_TURNS, assistantHistoryForRequest } from "./assistantAskContract.js";

/**
 * The one trim for Ask AI's conversation (F21 R3a): the web sends by it and the API accepts by it,
 * so a follow-up carries the same earlier turns on both sides.
 */
const turn = (n: number, answerLength = 10) => ({ question: `q${n}`, answer: "a".repeat(answerLength - String(n).length) + n });

describe("assistantHistoryForRequest", () => {
  it("keeps the newest turns, oldest first, and nothing when there is none", () => {
    expect(assistantHistoryForRequest(undefined)).toEqual([]);
    const kept = assistantHistoryForRequest(Array.from({ length: 9 }, (_, i) => turn(i + 1)));
    expect(kept.map((t) => t.question)).toEqual(["q4", "q5", "q6", "q7", "q8", "q9"]);
    expect(kept).toHaveLength(ASSISTANT_HISTORY_TURNS);
  });

  it("drops the oldest until the answers fit the budget", () => {
    const big = ASSISTANT_HISTORY_CHARS / 3; // three fit exactly, a fourth does not
    const kept = assistantHistoryForRequest([turn(1, big), turn(2, big), turn(3, big), turn(4, big)]);
    expect(kept.map((t) => t.question)).toEqual(["q2", "q3", "q4"]);
    expect(kept.reduce((n, t) => n + t.answer.length, 0)).toBe(ASSISTANT_HISTORY_CHARS);
  });

  it("skips malformed turns, trims whitespace, and cuts an over-long answer rather than dropping it", () => {
    const kept = assistantHistoryForRequest([
      { question: "  q1 ", answer: " fine " },
      { question: "q2" },
      { question: "", answer: "x" },
      "not a turn",
      { question: "q5", answer: "z".repeat(ASSISTANT_ANSWER_MAX + 50) },
    ]);
    expect(kept.map((t) => t.question)).toEqual(["q1", "q5"]);
    expect(kept[0]!.answer).toBe("fine");
    expect(kept[1]!.answer).toHaveLength(ASSISTANT_ANSWER_MAX);
  });
});
