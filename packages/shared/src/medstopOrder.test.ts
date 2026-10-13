import { describe, it, expect } from "vitest";
import {
  buildMedstopOrderPayload,
  medstopOrderInputSchema,
  medstopOrderRefusal,
  medstopRequestIsOpen,
  medstopRequestService,
  canOrderDrugTests,
  type MedstopOrderInput,
} from "./medstopOrder.js";

const input: MedstopOrderInput = {
  medstopId: "EE-1", service: "drug", reason: "POST-ACCIDENT", locationId: "LOC-9",
  requestDate: "2026-10-14", requestTime: "09:30", notifyBy: "PHONE CALL",
};
const office = { email: "der@silvicom.test", phone: "3125550100" };

/**
 * Owner answer 5 (2026-10-13): never text or e-mail a driver. Med-Stop's form arrives with the
 * driver's phone already in `tosms`, so the payload must carry the OFFICE's contact and switch both
 * of Med-Stop's own notices off — every order, whatever the inputs.
 */
describe("buildMedstopOrderPayload", () => {
  it("sends the office's contact, never the driver's, with Med-Stop's own texts and e-mails off", () => {
    const p = buildMedstopOrderPayload(input, office);
    expect(p).toMatchObject({ sendsms: "N", sendemail: "N", tosms: "3125550100", toemail: "der@silvicom.test" });
  });

  it("bills the company, as a DOT unobserved collection, in Med-Stop's own codes", () => {
    expect(buildMedstopOrderPayload(input, office)).toEqual({
      eeid: "EE-1", category: "TD", reason: "POST-ACCIDENT", dotstatus: "Y", observed: "N",
      requestdate: "2026-10-14", requesttime: "09:30", locationid: "LOC-9", payment: "EMPLOYER",
      notifyby: "PHONE CALL", sendsms: "N", sendemail: "N", tosms: "3125550100", toemail: "der@silvicom.test",
    });
    expect(buildMedstopOrderPayload({ ...input, service: "alcohol" }, office).category).toBe("TA");
  });
});

describe("medstopOrderInputSchema", () => {
  it("accepts a well-formed order", () => {
    expect(medstopOrderInputSchema.safeParse(input).success).toBe(true);
  });
  it("refuses a random test without its selection, and a selection on any other reason", () => {
    expect(medstopOrderInputSchema.safeParse({ ...input, reason: "RANDOM" }).success).toBe(false);
    expect(medstopOrderInputSchema.safeParse({ ...input, reason: "RANDOM", selectionId: "S-1" }).success).toBe(true);
    expect(medstopOrderInputSchema.safeParse({ ...input, selectionId: "S-1" }).success).toBe(false);
  });
  it("refuses the observed reasons until the donor's gender is held (UX5)", () => {
    for (const reason of ["RETURN TO DUTY", "FOLLOW-UP", "PRE-EMPLOYMENT"])
      expect(medstopOrderInputSchema.safeParse({ ...input, reason }).success).toBe(false);
  });
  it("refuses a field it does not know — nothing reaches Med-Stop that the preview did not show", () => {
    expect(medstopOrderInputSchema.safeParse({ ...input, tosms: "5551234567" }).success).toBe(false);
  });
  it("refuses a time that is not HH:MM", () => {
    expect(medstopOrderInputSchema.safeParse({ ...input, requestTime: "9:30" }).success).toBe(false);
    expect(medstopOrderInputSchema.safeParse({ ...input, requestTime: "24:00" }).success).toBe(false);
  });
});

describe("medstopOrderRefusal", () => {
  it("refuses a day in the past and one beyond Med-Stop's 30-day site window", () => {
    expect(medstopOrderRefusal(input, "2026-10-15")).toMatch(/today or a later day/);
    expect(medstopOrderRefusal({ ...input, requestDate: "2026-11-20" }, "2026-10-14")).toMatch(/30 days/);
    expect(medstopOrderRefusal(input, "2026-10-14")).toBeNull();
  });
});

describe("open requests", () => {
  it("counts unfinished statuses as open and finished ones as not", () => {
    for (const s of ["OPEN", "processing", "ACTIVE", "PREPARE", "TESTING"]) expect(medstopRequestIsOpen(s)).toBe(true);
    for (const s of ["COMPLETED", "CANCELED", "NO SHOW", "REFUSAL", "EXPIRED", "TEST CANCELED", null]) expect(medstopRequestIsOpen(s)).toBe(false);
  });
  it("reads a request's test by code or by label", () => {
    expect(medstopRequestService({ category: "DRUG TEST" })).toBe("drug");
    expect(medstopRequestService({ service: "TA" })).toBe("alcohol");
    expect(medstopRequestService({ service: "TM", category: "MEDICAL EXAMINATION" })).toBeNull();
  });
});

describe("canOrderDrugTests (owner answer 1)", () => {
  it("admits the safety manager, an admin and the recruiter — nobody else", () => {
    expect(["admin", "safety_manager", "recruiter"].every((r) => canOrderDrugTests(r as never))).toBe(true);
    expect(["fleet_manager", "dispatcher", "driver", null].some((r) => canOrderDrugTests(r as never))).toBe(false);
  });
});
