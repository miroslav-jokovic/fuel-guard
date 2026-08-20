import { describe, it, expect } from "vitest";
import {
  HIRE_DATE_MAX_FUTURE_DAYS,
  HIRE_HANDOFF_SOURCE,
  hiringGapsAfterHire,
  planHireHandoff,
  validateHireRequest,
  type HandoffEmployment,
} from "./hireHandoff.js";

const TODAY = "2026-08-19";

// Spread, not `??` per field — an explicit null for `inquirySentOn` is the exact case the
// never-invent-a-date rule exists for, and a defaulted fixture would hide it.
const employer = (over: Partial<HandoffEmployment> = {}): HandoffEmployment => ({
  id: "emp-1",
  employerName: "Old Carrier",
  usdotNumber: "123456",
  dotRegulated: true,
  inquiryStatus: "responded",
  inquirySentOn: "2026-07-01",
  inquiryResponseOn: "2026-07-14",
  ...over,
});

const plan = (employment: HandoffEmployment[], existing: Array<{ kind: string; detail: Record<string, unknown> | null }> = []) =>
  planHireHandoff({ employment, existing });

describe("what hiring files", () => {
  it("turns an answered inquiry into two dated records", () => {
    const { records, skipped } = plan([employer()]);
    expect(skipped).toEqual([]);
    expect(records.map((r) => [r.kind, r.occurredOn])).toEqual([
      ["previous_employer_inquiry", "2026-07-01"],
      ["previous_employer_response", "2026-07-14"],
    ]);
    expect(records[0]!.detail.employment_id).toBe("emp-1");
    expect(records[0]!.detail.source).toBe(HIRE_HANDOFF_SOURCE);
  });

  /** §391.23(d): a documented non-response is something a carrier may rely on, not a failure. */
  it("files a documented non-response as a response with its own result", () => {
    const { records } = plan([employer({ inquiryStatus: "no_response", inquiryResponseOn: "2026-08-01" })]);
    expect(records[1]!.kind).toBe("previous_employer_response");
    expect(records[1]!.result).toBe("no_response");
  });

  it("files the inquiry alone while an answer is still outstanding", () => {
    const { records, skipped } = plan([employer({ inquiryStatus: "sent", inquiryResponseOn: null })]);
    expect(records.map((r) => r.kind)).toEqual(["previous_employer_inquiry"]);
    expect(skipped).toEqual([]);
  });

  it("files nothing for an employer who owes no inquiry", () => {
    expect(plan([employer({ dotRegulated: false, inquiryStatus: "not_required" })])).toEqual({
      records: [],
      skipped: [],
    });
  });

  /**
   * No window filter, deliberately: an inquiry that was actually sent is evidence that exists, and
   * §391.23(a)(2)'s three years decides what is OWED, not what may be kept.
   */
  it("files an inquiry sent to an employer outside the three-year window", () => {
    const { records } = plan([employer({ inquirySentOn: "2019-02-02", inquiryResponseOn: "2019-03-03" })]);
    expect(records).toHaveLength(2);
  });
});

describe("what hiring refuses to file, and says instead", () => {
  it("never invents a date for an inquiry marked sent without one", () => {
    const { records, skipped } = plan([employer({ inquiryStatus: "sent", inquirySentOn: null })]);
    expect(records).toEqual([]);
    expect(skipped).toEqual([{ employmentId: "emp-1", employerName: "Old Carrier", reason: "undated_inquiry" }]);
  });

  it("never invents a date for a response marked answered without one", () => {
    const { records, skipped } = plan([employer({ inquiryResponseOn: null })]);
    expect(records.map((r) => r.kind)).toEqual(["previous_employer_inquiry"]);
    expect(skipped.map((s) => s.reason)).toEqual(["undated_response"]);
  });

  it("reports an inquiry nobody has sent as work still owed", () => {
    const { records, skipped } = plan([employer({ inquiryStatus: "pending", inquirySentOn: null, inquiryResponseOn: null })]);
    expect(records).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["inquiry_not_sent"]);
  });

  /** Re-running the handoff must be a no-op, not a second copy of the same evidence. */
  it("files nothing twice", () => {
    const existing = [
      { kind: "previous_employer_inquiry", detail: { employment_id: "emp-1" } },
      { kind: "previous_employer_response", detail: { employment_id: "emp-1" } },
    ];
    const { records, skipped } = plan([employer()], existing);
    expect(records).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["already_filed"]);
  });

  it("does not mistake another employer's record for this one's", () => {
    const existing = [{ kind: "previous_employer_inquiry", detail: { employment_id: "emp-OTHER" } }];
    expect(plan([employer()], existing).records).toHaveLength(2);
  });
});

describe("the hire date", () => {
  it("accepts today, a back-dated hire and a start date inside the year", () => {
    for (const d of [TODAY, "2024-01-01", "2027-08-18"]) {
      expect(validateHireRequest({ driver_id: "d", hire_date: d }, TODAY)).toEqual([]);
    }
  });

  it("refuses a start date further out than a year, which is a typo", () => {
    const issues = validateHireRequest({ driver_id: "d", hire_date: "2030-01-01" }, TODAY);
    expect(issues.map((i) => i.field)).toEqual(["hire_date"]);
    expect(issues[0]!.message).toContain(String(HIRE_DATE_MAX_FUTURE_DAYS));
  });
});

describe("what the file still needs afterwards", () => {
  it("names the §391.51(b) hiring items the handoff cannot supply", () => {
    const keys = hiringGapsAfterHire([], []).map((g) => g.key);
    expect(keys).toContain("employment_application");
    expect(keys).toContain("mvr_preemployment");
    expect(keys).toContain("previous_employer_inquiry");
    // Advisory items are never reported missing — a file without a PSP record is lawful (D-PSP1).
    expect(keys).not.toContain("psp_report");
    expect(keys).not.toContain("eldt");
  });

  it("counts what the handoff is about to write as satisfied", () => {
    const planned = planHireHandoff({ employment: [employer()], existing: [] }).records;
    const keys = hiringGapsAfterHire([], planned).map((g) => g.key);
    expect(keys).not.toContain("previous_employer_inquiry");
    expect(keys).not.toContain("previous_employer_response");
    expect(keys).toContain("mvr_preemployment");
  });
});
