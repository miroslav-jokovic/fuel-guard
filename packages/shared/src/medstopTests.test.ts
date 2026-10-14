import { describe, expect, it } from "vitest";
import {
  isMedstopDerAlert,
  medstopFilesHiringDrugTest,
  medstopResultNotice,
  isMedstopViolation,
  medstopRequestRefused,
  medstopRefusalDay,
  MEDSTOP_HISTORY_DAYS,
  medstopResultExpectedOn,
  medstopTestOutcome,
  medstopStageLabel,
  medstopOrderOpen,
  medstopTestKind,
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

describe("medstopFilesHiringDrugTest", () => {
  it("only a verified negative pre-employment DRUG test files the hiring step", () => {
    expect(medstopFilesHiringDrugTest({ service: "TD", reason: "PRE-EMPLOYMENT" }, "negative")).toBe(true);
    expect(medstopFilesHiringDrugTest({ service: "TD", reason: "RANDOM" }, "negative")).toBe(false);
    expect(medstopFilesHiringDrugTest({ service: "TA", reason: "PRE-EMPLOYMENT" }, "negative")).toBe(false);
    expect(medstopFilesHiringDrugTest({ service: "TD", reason: "PRE-EMPLOYMENT" }, "negative_dilute")).toBe(false);
    expect(medstopFilesHiringDrugTest({ service: "TD", reason: "PRE-EMPLOYMENT" }, "pending")).toBe(false);
  });
});

describe("medstopResultNotice", () => {
  const base = { service: "TD", reason: "RANDOM", collectedOn: "10/09/2026", personName: "Pat Driver" } as const;

  it("a violation on a certain match is critical and says dispatch is stopped", () => {
    const n = medstopResultNotice({ ...base, outcome: "positive", dispatchStopped: true });
    expect(n).toMatchObject({ title: "Drug test: action needed", severity: "critical" });
    expect(n.body).toBe("Pat Driver: verified positive on a random drug test collected 10/09/2026. Dispatch is stopped for this driver until return-to-duty documentation is filed.");
  });

  it("a violation without a certain match says dispatch was NOT stopped", () => {
    expect(medstopResultNotice({ ...base, outcome: "refusal", dispatchStopped: false }).body).toContain("dispatch was NOT stopped");
  });

  it("a dilute is a warning, never a stop", () => {
    const n = medstopResultNotice({ ...base, service: "TD", outcome: "negative_dilute", dispatchStopped: false });
    expect(n).toMatchObject({ title: "Drug test result to review", severity: "warning" });
    expect(n.body).toContain("recollection");
  });

  it("an alcohol test is named as one, and a missing name or date still reads", () => {
    const n = medstopResultNotice({ outcome: "positive", service: "TA", reason: null, collectedOn: null, personName: null, dispatchStopped: true });
    expect(n.title).toBe("Alcohol test: action needed");
    expect(n.body.startsWith("A person on Med-Stop's roster: verified positive on an alcohol test.")).toBe(true);
  });
});

describe("medstopStageLabel", () => {
  it("reads the measured trail in words, and OPEN after the lab as the MRO's review", () => {
    expect(medstopStageLabel("TD", "COMPLETED")).toBe("Collected");
    expect(medstopStageLabel("TD", "AT LAB")).toBe("At the lab");
    expect(medstopStageLabel("TD", "RESULTS")).toBe("With the medical review officer");
    expect(medstopStageLabel("TD", "OPEN")).toBe("With the medical review officer");
    expect(medstopStageLabel("TD", "CLOSED")).toBe("Result reported");
    expect(medstopStageLabel("TA", "COMPLETED")).toBe("Completed");
    expect(medstopStageLabel("TD", "SOMETHING NEW")).toBe("SOMETHING NEW");
  });
});

describe("medstopOrderOpen / medstopTestKind", () => {
  it("an order is open until a test exists or it ended", () => {
    for (const s of ["OPEN", "ACTIVE", "PROCESSING"]) expect(medstopOrderOpen(s)).toBe(true);
    for (const s of ["COMPLETED", "CANCELED", "NO SHOW", "EXPIRED", null]) expect(medstopOrderOpen(s)).toBe(false);
  });
  it("names the service", () => {
    expect([medstopTestKind("TD"), medstopTestKind("TA"), medstopTestKind("TM")]).toEqual(["drug", "alcohol", "medical"]);
  });
});

/** MEDSTOP-PLAN §7A.16: what a REFUSAL request means, and when it is history. */
describe("medstopRefusalDay", () => {
  const r = (extra: Partial<Parameters<typeof medstopRefusalDay>[0]>) =>
    ({ status: "REFUSAL", requested_local: "2026-10-10T09:00:00", tested_local: null, first_seen_at: "2026-10-10T15:00:00Z", ...extra });

  it("is the visit's day, else the appointment's, else the earliest day there is", () => {
    expect(medstopRefusalDay(r({ tested_local: "2026-10-11T08:00:00" }))).toBe("2026-10-11");
    expect(medstopRefusalDay(r({}))).toBe("2026-10-10");
    expect(medstopRefusalDay(r({ requested_local: null }))).toBe("0001-01-01");
  });

  it("is null for any status but REFUSAL", () => {
    for (const status of ["NO SHOW", "CANCELED", "COMPLETED", "TEST CANCELED", null]) expect(medstopRefusalDay(r({ status }))).toBeNull();
    expect(medstopRefusalDay(r({ status: " refusal " }))).toBe("2026-10-10");
  });

  it("is history — null — when made more than MEDSTOP_HISTORY_DAYS before we first saw it", () => {
    expect(medstopRefusalDay(r({ requested_local: "2026-09-26T09:00:00", first_seen_at: "2026-10-10T00:00:00Z" }))).toBe("2026-09-26");
    expect(medstopRefusalDay(r({ requested_local: "2026-09-25T09:00:00", first_seen_at: "2026-10-10T00:00:00Z" }))).toBeNull();
    expect(MEDSTOP_HISTORY_DAYS).toBe(14);
  });
});
