import { describe, it, expect } from "vitest";
import {
  buildMedstopOrderPayload,
  medstopDefaultGoBy,
  MEDSTOP_RECOLLECTION_OBSERVED_REASON,
  medstopOrderInputSchema,
  medstopOrderRefusal,
  medstopRequestIsOpen,
  medstopRequestService,
  canOrderDrugTests,
  medstopDonorGender,
  medstopOrderIsObserved,
  medstopSiteObserved,
  MEDSTOP_HEADER_ORDER_REASONS,
  MEDSTOP_ORDER_ROSTER,
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
  it("accepts the observed reasons now that the donor's gender is read from Med-Stop (UX5d), and no reason it does not order", () => {
    for (const reason of ["RETURN TO DUTY", "FOLLOW-UP"])
      expect(medstopOrderInputSchema.safeParse({ ...input, reason }).success).toBe(true);
    for (const reason of ["EXAMINATION", "RECERTIFICATION", "OTHER"])
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

describe("which roster a reason orders on (UX4)", () => {
  it("orders pre-employment on Med-Stop's applicant roster and every other reason on its active one", () => {
    expect(MEDSTOP_ORDER_ROSTER).toEqual({
      "PRE-EMPLOYMENT": "applicant", RANDOM: "active", "POST-ACCIDENT": "active", "REASONABLE SUSPICION": "active",
      "RETURN TO DUTY": "active", "FOLLOW-UP": "active",
    });
  });
  it("keeps pre-employment and random off Safety's header — one comes from hiring, the other from its selection", () => {
    expect(MEDSTOP_HEADER_ORDER_REASONS).toEqual(["POST-ACCIDENT", "REASONABLE SUSPICION", "RETURN TO DUTY", "FOLLOW-UP"]);
  });
  it("accepts a pre-employment order, which carries no selection", () => {
    expect(medstopOrderInputSchema.safeParse({ ...input, reason: "PRE-EMPLOYMENT" }).success).toBe(true);
    expect(medstopOrderInputSchema.safeParse({ ...input, reason: "PRE-EMPLOYMENT", selectionId: "SEL-1" }).success).toBe(false);
  });
});

/**
 * §40.67(b): every return-to-duty and follow-up DRUG test is a directly observed collection (UX5d).
 * Observation is a urine-collection rule, so the same reasons' alcohol (breath) test is not observed,
 * and the donor's gender — read from Med-Stop, never stored — chooses the site, never the payload.
 */
describe("observed collections (UX5d)", () => {
  it("observes the return-to-duty and follow-up drug tests, and nothing else", () => {
    for (const reason of ["RETURN TO DUTY", "FOLLOW-UP"] as const) {
      expect(medstopOrderIsObserved({ reason, service: "drug" })).toBe(true);
      expect(medstopOrderIsObserved({ reason, service: "alcohol" })).toBe(false);
    }
    for (const reason of ["PRE-EMPLOYMENT", "RANDOM", "POST-ACCIDENT", "REASONABLE SUSPICION"] as const)
      expect(medstopOrderIsObserved({ reason, service: "drug" })).toBe(false);
  });

  it("sends an observed drug test as observed, with the rule for the collector — and no gender in the order", () => {
    const p = buildMedstopOrderPayload({ ...input, reason: "RETURN TO DUTY" }, office);
    expect(p).toMatchObject({ reason: "RETURN TO DUTY", observed: "Y", observedreason: expect.stringContaining("49 CFR 40.67(b)") });
    expect(Object.keys(p).filter((k) => /gender/i.test(k))).toEqual([]);
    expect(buildMedstopOrderPayload({ ...input, reason: "FOLLOW-UP" }, office)).toMatchObject({ observed: "Y", observedreason: expect.stringMatching(/^Follow-up drug test/) });
  });

  it("sends the same reasons' alcohol test unobserved, with no observed reason", () => {
    const p = buildMedstopOrderPayload({ ...input, service: "alcohol", reason: "RETURN TO DUTY" }, office);
    expect(p.observed).toBe("N");
    expect(p).not.toHaveProperty("observedreason");
  });

  it("reads Med-Stop's gender as MALE or FEMALE only — anything else is no gender, never a guess", () => {
    expect(medstopDonorGender("MALE")).toBe("MALE");
    expect(medstopDonorGender(" female ")).toBe("FEMALE");
    for (const v of ["", "M", "F", "U", "UNKNOWN", null, undefined, 1]) expect(medstopDonorGender(v)).toBeNull();
  });

  it("searches sites for an observer of the donor's own gender, and for no observer otherwise", () => {
    expect(medstopSiteObserved(false, null)).toBe("N");
    expect(medstopSiteObserved(false, "FEMALE")).toBe("N");
    expect(medstopSiteObserved(true, "MALE")).toBe("M");
    expect(medstopSiteObserved(true, "FEMALE")).toBe("F");
    expect(() => medstopSiteObserved(true, null)).toThrow(/gender/);
  });
});

describe("medstopDefaultGoBy (D-MSO2)", () => {
  it("is the next business day at 4 pm: Monday after a Friday, Saturday or Sunday; tomorrow otherwise", () => {
    expect(medstopDefaultGoBy("2026-11-03")).toEqual({ requestDate: "2026-11-04", requestTime: "16:00" }); // Tue → Wed
    expect(medstopDefaultGoBy("2026-11-06").requestDate).toBe("2026-11-09"); // Fri → Mon
    expect(medstopDefaultGoBy("2026-11-07").requestDate).toBe("2026-11-09"); // Sat → Mon
    expect(medstopDefaultGoBy("2026-11-08").requestDate).toBe("2026-11-09"); // Sun → Mon
    expect(medstopDefaultGoBy("2026-12-31").requestDate).toBe("2027-01-01"); // over the year end
  });
});

describe("a recollection after a negative-dilute result (MSO3, D-MSO4)", () => {
  const recollect = { medstopId: "EE-1", service: "drug", reason: "PRE-EMPLOYMENT", locationId: "L", requestDate: "2026-11-04", requestTime: "16:00", notifyBy: "PHONE CALL", recollectionOf: "T-9" } as const;
  const office = { email: "o@x.test", phone: "3125550100" };

  it("is unobserved unless the office chooses it, and then cites §40.197(b)(1)", () => {
    expect(buildMedstopOrderPayload(medstopOrderInputSchema.parse(recollect), office)).toMatchObject({ observed: "N" });
    const chosen = buildMedstopOrderPayload(medstopOrderInputSchema.parse({ ...recollect, observed: true }), office);
    expect(chosen).toMatchObject({ observed: "Y", observedreason: MEDSTOP_RECOLLECTION_OBSERVED_REASON });
    expect(chosen.observedreason).toContain("40.197(b)(1)");
  });

  it("never lets the switch remove what the reason forces: a return-to-duty drug test stays observed under §40.67(b)", () => {
    expect(medstopOrderIsObserved({ reason: "RETURN TO DUTY", service: "drug", observed: false })).toBe(true);
    const p = buildMedstopOrderPayload(medstopOrderInputSchema.parse({ ...recollect, reason: "RETURN TO DUTY", observed: false }), office);
    expect(p).toMatchObject({ observed: "Y" });
    expect(p.observedreason).toContain("40.67(b)");
  });

  it("refuses observation by choice anywhere but a recollection, and a recollection of anything but a drug test", () => {
    const { recollectionOf: _r, ...plain } = recollect;
    expect(medstopOrderInputSchema.safeParse({ ...plain, observed: true }).success).toBe(false);
    expect(medstopOrderInputSchema.safeParse({ ...recollect, service: "alcohol" }).success).toBe(false);
    expect(medstopOrderInputSchema.safeParse({ ...recollect, observed: false }).success).toBe(true);
  });

  it("lets a random test's recollection go without a selection — it repeats the dilute test, not the draw", () => {
    expect(medstopOrderInputSchema.safeParse({ ...recollect, reason: "RANDOM" }).success).toBe(true);
    const { recollectionOf: _r, ...plain } = recollect;
    expect(medstopOrderInputSchema.safeParse({ ...plain, reason: "RANDOM" }).success).toBe(false);
    expect(medstopOrderInputSchema.safeParse({ ...recollect, reason: "RANDOM", selectionId: "S-1" }).success).toBe(false);
  });
});

