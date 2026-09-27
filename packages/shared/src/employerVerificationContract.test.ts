import { describe, expect, it } from "vitest";
import {
  VERIFICATION_QUESTIONS,
  employerVerificationCallSchema,
  verificationCallSummary,
} from "./employerVerificationContract.js";

/**
 * D-AW8 (APPLICATION-FLOW-V2-PLAN §6.5, C2b3): the phone call's contract and the text filing copies.
 */
const KEY = "40000000-0000-4000-8000-00000000000a";
const CONFIRMED = { dates: "confirmed", position: "confirmed", reason: "confirmed", cmv: "confirmed", dot_tested: "confirmed" } as const;
const call = (over: Record<string, unknown> = {}) => ({
  employer_key: KEY, answered_by: "Dana", called_at: "2026-09-24T10:15", outcomes: CONFIRMED, ...over,
});

describe("a call's answers", () => {
  it("takes all five questions, and nothing else — 0376's outcomes CHECK in words", () => {
    expect(employerVerificationCallSchema.safeParse(call()).success).toBe(true);
    const { cmv: _cmv, ...four } = CONFIRMED;
    expect(employerVerificationCallSchema.safeParse(call({ outcomes: four })).success).toBe(false);
    expect(employerVerificationCallSchema.safeParse(call({ outcomes: { ...CONFIRMED, salary: "confirmed" } })).success).toBe(false);
  });

  it("wants what the employer said for a corrected answer, and refuses words under any other", () => {
    const corrected = { ...CONFIRMED, reason: "corrected" };
    expect(employerVerificationCallSchema.safeParse(call({ outcomes: corrected })).success).toBe(false);
    expect(employerVerificationCallSchema.safeParse(call({ outcomes: corrected, corrections: { reason: "Laid off" } })).success).toBe(true);
    expect(employerVerificationCallSchema.safeParse(call({ corrections: { dates: "2019–2021" } })).success).toBe(false);
  });
});

describe("what filing copies as `body_sent`", () => {
  it("names the employer, the time on the carrier's clock, who answered, and every answer in order", () => {
    const text = verificationCallSummary({
      employerName: "Kowlage Haulage", answeredBy: "Dana", calledAtLocal: "2026-09-24 10:15", timeZone: "America/Chicago",
      outcomes: { ...CONFIRMED, position: "corrected", dot_tested: "not_confirmed" }, corrections: { position: "Yard hostler" },
    });
    expect(text.split("\n")).toEqual([
      "Telephone verification of employment with Kowlage Haulage.",
      "Called 2026-09-24 10:15 (America/Chicago); answered by Dana.",
      "Dates of employment: Confirmed.",
      'Position held: Corrected — "Yard hostler".',
      "Reason for leaving: Confirmed.",
      "Drove a commercial motor vehicle: Confirmed.",
      "Subject to DOT drug and alcohol testing: Not confirmed.",
    ]);
    expect(VERIFICATION_QUESTIONS).toHaveLength(5);
  });

});
