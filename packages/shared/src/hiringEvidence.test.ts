import { describe, it, expect } from "vitest";
import {
  HIRING_EVIDENCE_EARLIEST,
  HIRING_EVIDENCE_SOURCE,
  HIRING_RECORDED_ACT_STEPS,
  hiringEvidenceDetail,
  hiringEvidenceKind,
  hiringRecordedActKind,
  isHiringRecordedActStep,
  validateHiringEvidence,
  type HiringEvidenceFiling,
} from "./hiringEvidence.js";
import { HIRING_STEPS, hiringStep } from "./hiringSteps.js";
import { QUALIFICATION_RECORD_KINDS } from "./complianceContract.js";
import { TESTING_RECORD_KINDS } from "./auth.js";

/**
 * The door D1 opens onto `qualification_records` (D-HM6).
 *
 * ⚠ **Nothing here writes down a step→kind pair**, and that is the property under test rather than a
 * style preference: the mapping is read off `HiringEvidence.table`, so a fixture that listed
 * `mvr → "mvr"` would pass identically whether the function derived the answer or hard-coded it.
 * What the tests assert instead is that every derived kind is a REAL `QUALIFICATION_RECORD_KINDS`
 * member, which is the thing that breaks when the catalogue moves.
 */

const filing = (over: Partial<HiringEvidenceFiling> = {}): HiringEvidenceFiling => ({
  occurred_on: "2026-09-10",
  ...over,
});

describe("hiringEvidenceKind", () => {
  it("reads the kind off the step's evidence table rather than a list beside it", () => {
    // The assertion is the RELATIONSHIP, not the literal: whatever `hiringSteps.ts` says proves the
    // MVR step is what this returns. Change the table there and this follows it.
    const table = hiringStep("mvr").evidence?.table;
    expect(table).toBe("qualification_records.mvr");
    expect(hiringEvidenceKind("mvr")).toBe(table?.replace("qualification_records.", ""));
  });

  it("returns a real qualification kind for every step proved by a qualification record", () => {
    const kinds = new Set<string>(QUALIFICATION_RECORD_KINDS);
    const proved = HIRING_STEPS.filter((s) =>
      s.evidence?.table.startsWith("qualification_records."),
    );
    // Five today (mvr, psp, clearinghouse, drug test, medical registry) plus the road test. If this
    // is ever zero the derivation has silently stopped matching and every assertion below is vacuous.
    expect(proved.length).toBeGreaterThan(1);
    for (const spec of proved) {
      const kind = hiringEvidenceKind(spec.key);
      expect(kind, `${spec.key} resolves to a kind`).not.toBeNull();
      expect(kinds.has(kind as string), `${kind} is a real qualification_records kind`).toBe(true);
    }
  });

  it("is null for a step proved by something that is not a qualification record", () => {
    expect(hiringEvidenceKind("invitation_sent")).toBeNull();
    expect(hiringEvidenceKind("permissions_signed")).toBeNull();
    expect(hiringEvidenceKind("application_signed")).toBeNull();
    // And for the three D3/D4 still have to give an evidence table at all.
    expect(hiringEvidenceKind("orientation_videos")).toBeNull();
    expect(hiringEvidenceKind("handbook")).toBeNull();
  });
});

describe("hiringRecordedActKind — what this door may file", () => {
  it("answers for each of D1's three, with the kind the catalogue names", () => {
    expect(hiringRecordedActKind("mvr")).toBe("mvr");
    expect(hiringRecordedActKind("clearinghouse")).toBe("clearinghouse_full");
    expect(hiringRecordedActKind("drug_test")).toBe("drug_test");
  });

  it("refuses PSP, whose own door carries the consent attestation", () => {
    // `psp` IS proved by a qualification record, so the general derivation resolves it — and this
    // door still refuses. That gap is the whole reason the step list is written down.
    expect(hiringEvidenceKind("psp")).toBe("psp_report");
    expect(hiringRecordedActKind("psp")).toBeNull();
    expect(isHiringRecordedActStep("psp")).toBe(false);
  });

  it("refuses the road test and the medical certificate, which D2 and Q-HM11 own", () => {
    expect(hiringRecordedActKind("road_test")).toBeNull();
    expect(hiringRecordedActKind("medical_certificate")).toBeNull();
  });

  it("refuses a string that is not a step at all", () => {
    expect(hiringRecordedActKind("cdl")).toBeNull();
    expect(hiringRecordedActKind("")).toBeNull();
  });

  it("carries two of §382.401(a)'s testing kinds, so the route's restriction check is load-bearing", () => {
    // If this ever reads zero, the API test asserting a recruiter is refused the drug test is
    // asserting nothing — the restriction would be enforced against a set the door cannot reach.
    const testing = new Set<string>(TESTING_RECORD_KINDS);
    const restricted = HIRING_RECORDED_ACT_STEPS.map(hiringRecordedActKind).filter(
      (k) => k !== null && testing.has(k),
    );
    expect(restricted).toEqual(["clearinghouse_full", "drug_test"]);
  });
});

describe("validateHiringEvidence", () => {
  it("accepts a date on or before today", () => {
    expect(validateHiringEvidence(filing({ occurred_on: "2026-09-19" }), "2026-09-19")).toEqual([]);
    expect(validateHiringEvidence(filing({ occurred_on: "2020-01-06" }), "2026-09-19")).toEqual([]);
  });

  it("refuses a result dated tomorrow — §382.301(a) wants a verified negative, not a promised one", () => {
    const issues = validateHiringEvidence(filing({ occurred_on: "2026-09-20" }), "2026-09-19");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("occurred_on");
  });

  it("catches the digit slip that dates a §391.51 file to the 11th century", () => {
    const issues = validateHiringEvidence(filing({ occurred_on: "1011-03-04" }), "2026-09-19");
    expect(issues.map((i) => i.message.includes("mistyped"))).toEqual([true]);
    // The boundary itself, so the floor cannot be quietly moved without a test moving with it.
    expect(validateHiringEvidence(filing({ occurred_on: HIRING_EVIDENCE_EARLIEST }), "2026-09-19")).toEqual([]);
  });
});

describe("hiringEvidenceDetail", () => {
  it("records the provenance and claims nothing about the content", () => {
    const detail = hiringEvidenceDetail("mvr", "user-1");
    expect(detail.source).toBe(HIRING_EVIDENCE_SOURCE);
    expect(detail.structured).toBe(false);
    expect(detail.hiring_step).toBe("mvr");
    expect(detail.recorded_by).toBe("user-1");
    // No result, no counts, no verdict: nothing read this record, so nothing may be implied from it.
    expect(Object.keys(detail).sort()).toEqual(["hiring_step", "recorded_by", "source", "structured"]);
  });

  it("names the step it was filed from, so two kinds cannot be told apart by luck", () => {
    expect(hiringEvidenceDetail("drug_test", "user-1").hiring_step).toBe("drug_test");
    expect(hiringEvidenceDetail("clearinghouse", "user-1").hiring_step).toBe("clearinghouse");
  });

  it("writes an MVR's jurisdiction, trimmed, and leaves the key off when none was given (AF7)", () => {
    expect(hiringEvidenceDetail("mvr", "user-1", "  IL ").jurisdiction).toBe("IL");
    expect("jurisdiction" in hiringEvidenceDetail("mvr", "user-1", "   ")).toBe(false);
    expect("jurisdiction" in hiringEvidenceDetail("mvr", "user-1", null)).toBe(false);
  });

  it("never writes a jurisdiction onto a drug test or a Clearinghouse query", () => {
    expect("jurisdiction" in hiringEvidenceDetail("drug_test", "user-1", "IL")).toBe(false);
    expect("jurisdiction" in hiringEvidenceDetail("clearinghouse", "user-1", "IL")).toBe(false);
  });
});
