import { describe, expect, it } from "vitest";
import { reconcileGapExplanations } from "./employmentProgress";

describe("reconcileGapExplanations (C3c1)", () => {
  const gap = (from: string, to: string) => ({ from, to });

  it("gives a new gap an empty box, and keeps the words of an unchanged one", () => {
    expect(reconcileGapExplanations(
      [{ from: "2023-09-26", to: "2024-01-15", explanation: "School" }],
      [gap("2023-09-26", "2024-01-15"), gap("2025-03-01", "2025-06-01")],
    )).toEqual([
      { from: "2023-09-26", to: "2024-01-15", explanation: "School" },
      { from: "2025-03-01", to: "2025-06-01", explanation: "" },
    ]);
  });

  it("carries the words to a gap that moved, re-keyed to its new dates", () => {
    // The driver corrected a job's start date, and the gap before it shrank by a month.
    expect(reconcileGapExplanations(
      [{ from: "2023-09-26", to: "2024-02-15", explanation: "School" }],
      [gap("2023-09-26", "2024-01-15")],
    )).toEqual([{ from: "2023-09-26", to: "2024-01-15", explanation: "School" }]);
  });

  it("drops the words of a gap that closed, so they are never filed against a question not asked", () => {
    expect(reconcileGapExplanations([{ from: "2023-09-26", to: "2024-01-15", explanation: "School" }], [])).toEqual([]);
  });
});
