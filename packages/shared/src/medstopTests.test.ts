import { describe, expect, it } from "vitest";
import {
  isMedstopDerAlert,
  isMedstopViolation,
  medstopRequestRefused,
  medstopResultExpectedOn,
  medstopTestOutcome,
} from "./medstopTests.js";

describe("medstopTestOutcome", () => {
  const closedDrug = (result: string | null) => medstopTestOutcome({ service: "TD", status: "CLOSED", result });

  it("classifies every wording the twelve months held, and the refusal the list names", () => {
    expect(closedDrug("NEGATIVE")).toBe("negative");
    expect(closedDrug("NEGATIVE - DILUTE")).toBe("negative_dilute");
    expect(closedDrug("POSITIVE")).toBe("positive");
    expect(closedDrug("CANCELED")).toBe("cancelled");
    expect(closedDrug("NOT REFUSAL")).toBe("not_refusal");
    expect(closedDrug("REFUSAL TO TEST")).toBe("refusal");
  });

  it("a drug result before Med-Stop reviews or closes the test is not a result", () => {
    for (const status of ["OPEN", "COMPLETED", "AT LAB", "RESULTS", null]) {
      expect(medstopTestOutcome({ service: "TD", status, result: "POSITIVE" })).toBe("pending");
    }
    expect(medstopTestOutcome({ service: "TD", status: "REVIEWED", result: "POSITIVE" })).toBe("positive");
  });

  it("an alcohol result is final at collection — there is no MRO to wait for", () => {
    expect(medstopTestOutcome({ service: "TA", status: "COMPLETED", result: "NEGATIVE" })).toBe("negative");
  });

  it("a medical examination is not a drug or alcohol outcome", () => {
    expect(medstopTestOutcome({ service: "TM", status: "COMPLETED", result: "MEETS STANDARDS IN 49 CFR 391.41" })).toBe("medical");
  });

  it("no result is pending, and a wording nobody classified is not a negative", () => {
    expect(closedDrug(null)).toBe("pending");
    expect(closedDrug("  ")).toBe("pending");
    expect(closedDrug("SUBSTITUTED")).toBe("unrecognised");
  });

  it("violations and alerts are the outcomes the DER must hear about, and no others", () => {
    expect(isMedstopViolation("positive")).toBe(true);
    expect(isMedstopViolation("refusal")).toBe(true);
    expect(isMedstopViolation("negative_dilute")).toBe(false);
    expect(isMedstopDerAlert("negative_dilute")).toBe(true);
    expect(isMedstopDerAlert("unrecognised")).toBe(true);
    for (const o of ["negative", "not_refusal", "cancelled", "medical", "pending"] as const) expect(isMedstopDerAlert(o)).toBe(false);
  });
});

describe("medstopRequestRefused", () => {
  it("only Med-Stop's REFUSAL request status", () => {
    expect(medstopRequestRefused("REFUSAL")).toBe(true);
    expect(medstopRequestRefused("NO SHOW")).toBe(false);
    expect(medstopRequestRefused(null)).toBe(false);
  });
});

describe("medstopResultExpectedOn", () => {
  it("a drug test is expected 93 hours after collection, as a wall-clock day", () => {
    expect(medstopResultExpectedOn("TD", "2026-10-09T14:24:00")).toBe("2026-10-13");
    expect(medstopResultExpectedOn("TD", "2026-10-09T02:00:00")).toBe("2026-10-12");
  });

  it("no date for an alcohol test, a missing stamp, or one we cannot read", () => {
    expect(medstopResultExpectedOn("TA", "2026-10-09T14:24:00")).toBeNull();
    expect(medstopResultExpectedOn("TD", null)).toBeNull();
    expect(medstopResultExpectedOn("TD", "soon")).toBeNull();
  });
});
