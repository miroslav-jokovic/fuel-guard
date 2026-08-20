import { describe, it, expect } from "vitest";
import {
  DATE_DISCREPANCY_TOLERANCE_DAYS,
  dateDiscrepancies,
  employerResponseSchema,
} from "./employerResponseContract.js";

const reply = (over: Record<string, unknown> = {}) => ({
  employment_confirmed: true,
  verified_started_on: "2023-01-01",
  verified_ended_on: "2025-06-30",
  position_held: "Driver",
  accidents: [],
  reports_no_accidents: true,
  ...over,
});

describe("what an employer's reply must say", () => {
  it("accepts a nil return as an answer", () => {
    expect(employerResponseSchema.safeParse(reply()).success).toBe(true);
  });

  /**
   * An empty accident list means "they reported none" or "we have not asked yet" depending on who is
   * reading, and the difference matters: one is evidence and the other is a gap.
   */
  it("refuses an empty list that does not say it is empty", () => {
    const parsed = employerResponseSchema.safeParse(reply({ reports_no_accidents: false }));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("reported none");
  });

  it("takes the §390.15(b)(1) elements in the applicant's own accident shape", () => {
    const parsed = employerResponseSchema.safeParse(
      reply({
        reports_no_accidents: false,
        accidents: [
          { occurred_on: "2024-03-04", nature: "Rear-ended at a light", fatalities: 0, injuries: 1, hazmat_spill: false },
        ],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("records a refusal to confirm employment at all", () => {
    const parsed = employerResponseSchema.safeParse(
      reply({ employment_confirmed: false, verified_started_on: null, verified_ended_on: null }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("where the employer and the applicant disagree about dates", () => {
  const declared = { started_on: "2023-01-01", ended_on: "2025-06-30" };

  it("says nothing when they agree", () => {
    expect(dateDiscrepancies(declared, reply())).toEqual([]);
  });

  /** People remember jobs to the month, not the day. A flag on three days teaches somebody to ignore flags. */
  it("tolerates the ordinary imprecision of remembering a job", () => {
    expect(
      dateDiscrepancies(declared, reply({ verified_started_on: "2023-01-20", verified_ended_on: "2025-07-10" })),
    ).toEqual([]);
  });

  it("reports a gap wide enough to be worth asking about", () => {
    const out = dateDiscrepancies(declared, reply({ verified_started_on: "2023-06-01" }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: "started_on", declared: "2023-01-01", reported: "2023-06-01" });
    expect(out[0]!.days).toBeGreaterThan(DATE_DISCREPANCY_TOLERANCE_DAYS);
  });

  it("says nothing about an end date the employer did not give", () => {
    expect(dateDiscrepancies(declared, reply({ verified_ended_on: null }))).toEqual([]);
  });

  it("says nothing when the applicant is still there and the employer disagrees", () => {
    // A current job has no declared end date to compare against; the disagreement, if any, is about
    // whether they still work there — a conversation, not an arithmetic result.
    expect(
      dateDiscrepancies({ started_on: "2023-01-01", ended_on: null }, reply({ verified_ended_on: "2025-06-30" })),
    ).toEqual([]);
  });
});
