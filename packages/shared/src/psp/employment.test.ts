import { describe, it, expect } from "vitest";
import { crossMatchEmployment, type DeclaredEmployment } from "./employment.js";
import type { PspCrashRecord, PspInspectionRecord } from "./parse.js";

const ASOF = "2026-08-19";
// PSP windows from the pull date: inspections → 2023-08-19, crashes → 2021-08-19.
// §391.21 windows from the application: (b)(10) → 2023-08-19, (b)(11) → 2016-08-19.

// Spread, not `??` per field — `usdotNumber: o.usdotNumber ?? "111111"` silently restores the
// default when a test passes an explicit null, which is exactly the case the name-match rule is for.
const job = (o: Partial<DeclaredEmployment> & Pick<DeclaredEmployment, "id" | "startedOn">): DeclaredEmployment => ({
  employerName: "Old Carrier Inc",
  usdotNumber: "111111",
  endedOn: null,
  ...o,
});

const insp = (usdot: string | null, date: string, name: string | null = "OLD CARRIER INC") =>
  ({ inspectionId: null, reportState: null, reportNumber: null, inspectionDate: date, inspectionLevelId: null, usdotNumber: usdot, carrierName: name, totalDriverViolations: 0, totalDriverOOS: 0, violations: [] }) as PspInspectionRecord;

const crash = (usdot: string | null, date: string, over: Partial<PspCrashRecord> = {}) =>
  ({ reportState: null, reportNumber: null, reportDate: date, usdotNumber: usdot, carrierName: over.carrierName ?? null, fatalities: 0, injuries: 0, towAway: false, notPreventable: over.notPreventable ?? false, notPreventableDesc: null }) as PspCrashRecord;

const run = (over: Partial<Parameters<typeof crossMatchEmployment>[0]> = {}) =>
  crossMatchEmployment({
    declared: over.declared ?? [],
    declaredAccidents: over.declaredAccidents ?? [],
    inspections: over.inspections ?? [],
    crashes: over.crashes ?? [],
    ownDotNumber: over.ownDotNumber ?? "999999",
    asOf: over.asOf ?? ASOF,
    pulledOn: over.pulledOn ?? ASOF,
  });

/**
 * D-PSP5, and the reason this file is careful: a driver can work two years and never be inspected.
 * PSP corroborates or it discovers. It NEVER refutes, and a design that reported silence as doubt
 * would flag exactly the drivers who drive cleanly.
 */
describe("corroborating what the applicant declared", () => {
  it("corroborates an employer PSP saw activity under", () => {
    const out = run({
      declared: [job({ id: "e1", startedOn: "2024-01-01" })],
      inspections: [insp("111111", "2025-03-04")],
    });
    expect(out.employers[0]).toMatchObject({ match: "corroborated", inspections: 1 });
  });

  it("says NOTHING about an employer PSP saw nothing under — silence is not doubt", () => {
    const out = run({ declared: [job({ id: "e1", startedOn: "2024-01-01" })] });
    expect(out.employers[0]!.match).toBe("no_psp_activity");
    expect(out.unlisted).toEqual([]);
  });

  /** `no_psp_activity` and `outside_psp_window` look alike and mean opposite things. */
  it("separates 'PSP looked and saw nothing' from 'PSP could not have seen it'", () => {
    const out = run({
      declared: [job({ id: "old", startedOn: "2017-01-01", endedOn: "2019-01-01" })],
    });
    // Crashes reach back 5 years — 2019 predates even that.
    expect(out.employers[0]!.match).toBe("outside_psp_window");
  });

  it("only counts activity INSIDE the declared period", () => {
    const out = run({
      declared: [job({ id: "e1", startedOn: "2024-01-01", endedOn: "2024-06-01" })],
      inspections: [insp("111111", "2025-03-04")],
    });
    // Same carrier, but after they say they left — so it corroborates nothing about this period, and
    // it is not unlisted either, because the DOT number IS on the application.
    expect(out.employers[0]!.match).toBe("no_psp_activity");
    expect(out.unlisted).toEqual([]);
  });

  /** D-PSP6 — a name match is a question for a person, never a link. */
  it("offers a name-only match as a candidate and never as a corroboration", () => {
    const out = run({
      declared: [job({ id: "e1", usdotNumber: null, employerName: "Swift Transportation", startedOn: "2024-01-01" })],
      inspections: [insp("222222", "2025-03-04", "SWIFT TRANSPORTATION CO")],
    });
    expect(out.employers[0]!.match).toBe("no_psp_activity");
    expect(out.employers[0]!.nameOnlyCandidates).toEqual(["SWIFT TRANSPORTATION CO"]);
    // And it is STILL reported as unlisted, because nothing has linked it yet.
    expect(out.unlisted.map((u) => u.usdotNumber)).toEqual(["222222"]);
  });
});

describe("discovering what the applicant did not declare", () => {
  it("reports a carrier PSP saw that the application never mentions", () => {
    const out = run({
      declared: [job({ id: "e1", startedOn: "2024-01-01" })],
      inspections: [insp("333333", "2025-05-01", "MYSTERY HAULING")],
    });
    expect(out.unlisted).toHaveLength(1);
    expect(out.unlisted[0]).toMatchObject({ usdotNumber: "333333", carrierName: "MYSTERY HAULING", owedTo: "b10" });
  });

  /** A feature whose first finding is "this driver appears to have worked for you" is untrustworthy. */
  it("never reports OUR OWN dot number as an unlisted employer", () => {
    const out = run({ inspections: [insp("999999", "2025-05-01")] });
    expect(out.unlisted).toEqual([]);
  });

  it("says which list the applicant owed the employer to", () => {
    const out = run({
      inspections: [insp("444444", "2025-01-01"), insp("555555", "2022-01-01")],
      // Older than ten years, so nothing was owed. PSP holds crashes for five, so this branch is
      // defensive rather than reachable from a real response — which is why it is worth pinning.
      crashes: [crash("666666", "2014-01-01")],
    });
    const by = Object.fromEntries(out.unlisted.map((u) => [u.usdotNumber, u.owedTo]));
    expect(by["444444"]).toBe("b10");    // inside the 3 years
    expect(by["555555"]).toBe("b11");    // years 3-10, CMV — and an inspection PROVES CMV operation
    expect(by["666666"]).toBe("outside"); // older than ten years; nothing was owed
  });

  it("collapses many sightings of one carrier into one finding with a date range", () => {
    const out = run({
      inspections: [insp("777777", "2024-01-01"), insp("777777", "2025-06-01")],
      crashes: [crash("777777", "2024-09-01")],
    });
    expect(out.unlisted).toHaveLength(1);
    expect(out.unlisted[0]).toMatchObject({ firstSeen: "2024-01-01", lastSeen: "2025-06-01", inspections: 2, crashes: 1 });
  });
});

/** §391.21(b)(7) asks for 3 years of accidents; PSP holds 5. Only the overlap can be a discrepancy. */
describe("accidents the applicant did not list", () => {
  it("reports a crash inside the 3-year window that was not declared", () => {
    const out = run({ crashes: [crash("111111", "2025-02-02")] });
    expect(out.undeclaredCrashes).toHaveLength(1);
  });

  it("does not report one the applicant declared", () => {
    const out = run({
      crashes: [crash("111111", "2025-02-02")],
      declaredAccidents: [{ occurredOn: "2025-02-02" }],
    });
    expect(out.undeclaredCrashes).toEqual([]);
  });

  /** A crash from year four was never required on the form; reporting it invents an obligation. */
  it("does not report one older than the question asks about", () => {
    const out = run({ crashes: [crash("111111", "2022-02-02")] });
    expect(out.undeclaredCrashes).toEqual([]);
  });

  /** §10.5 — it still had to be DECLARED, but it must never be counted against the driver. */
  it("carries notPreventable through so a non-preventable crash is not held against them", () => {
    const out = run({ crashes: [crash("111111", "2025-02-02", { notPreventable: true })] });
    expect(out.undeclaredCrashes[0]!.notPreventable).toBe(true);
  });
});

describe("the honest case", () => {
  it("produces NOTHING for a truthful application and a clean record", () => {
    const out = run({
      declared: [job({ id: "e1", startedOn: "2019-01-01" })],
      inspections: [insp("111111", "2025-01-01")],
    });
    expect(out.employers[0]!.match).toBe("corroborated");
    expect(out.unlisted).toEqual([]);
    expect(out.undeclaredCrashes).toEqual([]);
  });
});
