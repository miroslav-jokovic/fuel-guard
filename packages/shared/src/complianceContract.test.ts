import { describe, expect, it } from "vitest";
import { qualificationRecordCreateSchema } from "./complianceContract.js";

/**
 * The §3.2 record contract's kind rules — the ones that exist because a table constraint would
 * otherwise answer with a 500.
 */
describe("filing a PSP record through the generic endpoint (0219)", () => {
  const base = {
    id: "11111111-2222-4333-8444-555555555555",
    driverId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    occurredOn: "2026-08-01",
  };

  /**
   * The CHECK constraint requires `detail.source` on every psp_report row, and this form has no
   * field for it and no way to know the answer. Without the refusal the request would reach Postgres
   * and come back a 500 — a database error where the honest answer is "not this endpoint's job".
   */
  it("is refused, and the message says where to go instead", () => {
    const parsed = qualificationRecordCreateSchema.safeParse({ ...base, kind: "psp_report", detail: {} });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("Employment tab");
  });

  it("leaves every other kind alone", () => {
    for (const kind of ["mvr", "drug_test", "previous_employer_response"]) {
      expect(qualificationRecordCreateSchema.safeParse({ ...base, kind, detail: {} }).success).toBe(true);
    }
  });
});
