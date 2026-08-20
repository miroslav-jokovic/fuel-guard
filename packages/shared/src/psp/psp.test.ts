import { describe, it, expect } from "vitest";
import { PSP_ERROR_DETAILS, isBilled, needsOperatorAction, readStatus } from "./status.js";
import { PSP_MAX_DRIVERS_PER_REQUEST, validatePspRequest, type PspRequestDraft } from "./validate.js";
import { isCleanRecord, parsePspReport } from "./parse.js";

const TODAY = "2026-08-19";

// Spread, not `??` per field: `dotNumber: over.dotNumber ?? "43586"` silently restores the default
// when a test passes an explicit null, which is exactly the case the detail-10 rule is about.
const draft = (over: Partial<PspRequestDraft> = {}): PspRequestDraft => ({
  driverFirstName: "SUSAN",
  driverLastName: "GODFREY",
  driverDOB: "1949-12-11",
  dotNumber: "43586",
  internalRefId: "driver-uuid",
  driverConsent: true,
  licenseQueries: [{ dlNum: "PA334554", dlState: "PA", dlFirstName: "SUSAN", dlLastName: "GODFREY" }],
  ...over,
});

const codes = (d: PspRequestDraft) => validatePspRequest(d, TODAY).map((i) => i.preventsDetail).sort();

/**
 * §8: "Accounts are charged the transaction fee for 'Success,' 'Partial' and 'Failure' response
 * statuses." Error is NOT on that list. That asymmetry is the whole economics of this integration.
 */
describe("what PSP charges for", () => {
  it("bills a Failure exactly as it bills a Success", () => {
    expect(isBilled(0)).toBe(true);
    expect(isBilled(1)).toBe(true);
    expect(isBilled(4)).toBe(true);
    expect(isBilled(2)).toBe(false);
  });

  /**
   * Status 3 is in the production OpenAPI's enum and in no version of the guide (PSP-PLAN §2.6).
   * Defaulting it either way is wrong in both directions — as success it files a record that may not
   * exist, as failure it hides one we paid for. `billed: true` because the safe assumption about
   * money is that it was spent.
   */
  it("treats an undocumented status as unknown, and assumes it cost us", () => {
    const three = readStatus(3);
    expect(three.outcome).toBe("unknown");
    expect(three.billed).toBe(true);
    expect(readStatus(99).outcome).toBe("unknown");
  });

  it("separates the errors an operator must act on from the ones a caller can fix", () => {
    // Token and account problems: no amount of re-validating helps.
    for (const d of [22, 30, 32, 33]) expect(needsOperatorAction(d)).toBe(true);
    // Data problems: fix the request.
    for (const d of [1, 4, 8, 27]) expect(needsOperatorAction(d)).toBe(false);
  });

  it("marks the §8.5 details we can catch before spending anything", () => {
    const preflight = PSP_ERROR_DETAILS.filter((d) => d.preflight).map((d) => d.detail);
    expect(preflight).toEqual([1, 2, 3, 4, 5, 8, 10, 17, 24, 25, 26, 27, 31]);
  });
});

describe("pre-flight validation — every rule prevents a named §8.5 code", () => {
  it("passes the guide's own test driver", () => {
    expect(validatePspRequest(draft(), TODAY)).toEqual([]);
  });

  it("refuses a request with no carrier identity (detail 10)", () => {
    expect(codes(draft({ dotNumber: null }))).toContain(10);
    // Either one satisfies it — §5.4.1 asks for a DOT number OR a Motor Carrier ID.
    expect(codes(draft({ dotNumber: null, motorCarrierId: "10708" }))).not.toContain(10);
  });

  it("refuses a request without the driver's authorization (detail 17)", () => {
    expect(codes(draft({ driverConsent: false }))).toContain(17);
  });

  it("refuses a date of birth PSP would have charged us to reject (details 1 and 27)", () => {
    expect(codes(draft({ driverDOB: "" }))).toContain(1);
    expect(codes(draft({ driverDOB: "1990-02-31" }))).toContain(1);
    expect(codes(draft({ driverDOB: "2015-01-01" }))).toContain(27);
  });

  it("holds names to the guide's character rules (details 2 and 25)", () => {
    expect(codes(draft({ driverFirstName: "SUSAN2" }))).toContain(2);
    expect(codes(draft({ driverLastName: "O'BRIEN" }))).not.toContain(25);
    expect(codes(draft({ driverLastName: "SMITH-JONES" }))).not.toContain(25);
    expect(codes(draft({ driverFirstName: "A".repeat(21) }))).toContain(2);
  });

  /**
   * The LICENCE names take a different rule from the driver's own — "only letters and numbers"
   * against "only letters, hyphens and apostrophes". The guide means it: details 2/25 and 5/26 say
   * different things, and an apostrophe that is fine on one is not on the other.
   */
  it("applies the licence-name rule, which is not the driver-name rule (details 5 and 26)", () => {
    expect(codes(draft({ licenseQueries: [{ dlNum: "X1", dlState: "IL", dlFirstName: "SUSAN", dlLastName: "O'BRIEN" }] }))).toContain(26);
    expect(codes(draft({ licenseQueries: [{ dlNum: "X1", dlState: "IL", dlFirstName: "SUSAN", dlLastName: "OBRIEN2" }] }))).not.toContain(26);
  });

  it("enumerates jurisdictions rather than counting characters (detail 8)", () => {
    const q = (dlState: string) => draft({ licenseQueries: [{ dlNum: "X1", dlState, dlFirstName: "A", dlLastName: "B" }] });
    expect(codes(q("XX"))).toContain(8);   // two letters, not a place
    expect(codes(q(""))).toContain(8);
    expect(codes(q("IL"))).not.toContain(8);
    expect(codes(q("ON"))).not.toContain(8); // Canadian province
    expect(codes(q("PR"))).not.toContain(8); // US territory
    expect(codes(q("MX"))).not.toContain(8); // §8.5 names it explicitly
    expect(codes(q("il"))).not.toContain(8); // case is ours to normalise, not the operator's problem
  });

  it("refuses an over-long licence number or reference (details 24 and 3)", () => {
    expect(codes(draft({ licenseQueries: [{ dlNum: "X".repeat(26), dlState: "IL", dlFirstName: "A", dlLastName: "B" }] }))).toContain(24);
    expect(codes(draft({ internalRefId: "x".repeat(257) }))).toContain(3);
  });

  it("refuses a request with no licence at all", () => {
    expect(codes(draft({ licenseQueries: [] }))).toContain(4);
  });

  /**
   * §5: "If there are any validation issues with any of the driver record requests, the entire
   * request is cancelled." One bad row in a batch of 200 kills 199 good ones, so the client sends one.
   */
  it("pins one driver per request", () => {
    expect(PSP_MAX_DRIVERS_PER_REQUEST).toBe(1);
  });
});

describe("parsing a report", () => {
  const success = {
    driverInformationResponse: {
      status: 0,
      statusDetail: 0,
      authCode: "abc-123",
      internalRefId: "driver-uuid",
      driverLicenseNumber: "PA334554",
      driverLicenseState: "PA",
      driverInfoSummary: { driverInspCount: "4", driverOOSCount: "1", driverOOSRate: 25 },
      driverRecord: {
        inspectionRecords: [
          {
            inspectionId: "9001",
            usdotNumber: "43586",
            carrierName: "OLD CARRIER INC",
            inspectionDate: "2024-05-02",
            totalDriverViolations: "2",
            inspectionViolations: [
              { inspViolationId: 5, partNoSection: "392.2C", sectionDesc: "Speeding", outOfServiceIndicator: "N", citationResult: 1 },
              { inspViolationId: 6, partNoSection: "395.8", sectionDesc: "Log", outOfServiceIndicator: "Y" },
            ],
          },
        ],
        crashRecords: [
          { reportState: "IL", reportNumber: "7", reportDate: "2023-01-04", censusNumber: "43586", fatalities: "0", injuries: "1", towAway: "Y", notPreventable: "Y", notPreventableDesc: "Struck while parked" },
        ],
      },
    },
    driverReportSummaryResponse: { numCrashes: 1, numCrashesNotPreventable: 1, numTowaways: "1" },
    monitor: false,
  };

  it("projects the fields the product uses and leaves the rest in the raw response", () => {
    const r = parsePspReport(success);
    expect(r.outcome).toBe("success");
    expect(r.billed).toBe(true);
    expect(r.authCode).toBe("abc-123");
    expect(r.summary.driverInspCount).toBe(4);
    expect(r.inspections).toHaveLength(1);
    expect(r.inspections[0]!.usdotNumber).toBe("43586");
    expect(r.inspections[0]!.violations).toHaveLength(2);
  });

  it("reads vendor numbers that arrive as strings", () => {
    const r = parsePspReport(success);
    expect(r.summary.driverInspCount).toBe(4);
    expect(r.summary.towaways).toBe(1);
    expect(r.inspections[0]!.totalDriverViolations).toBe(2);
  });

  /** §2.6: the vendor types this int32. Carried raw so nobody multiplies it by 100 on a hunch. */
  it("carries the OOS rate raw rather than converting it", () => {
    expect(parsePspReport(success).summary.driverOOSRateRaw).toBe(25);
  });

  /** §10.4 — a violation a court threw out and one that stuck look identical without this. */
  it("keeps the adjudication result", () => {
    const v = parsePspReport(success).inspections[0]!.violations;
    expect(v[0]!.citationResult).toBe(1);
    expect(v[0]!.outOfService).toBe(false);
    expect(v[1]!.outOfService).toBe(true);
  });

  /** §10.5 — a crash FMCSA deemed non-preventable must never be counted against the driver. */
  it("keeps notPreventable and its description", () => {
    const c = parsePspReport(success).crashes[0]!;
    expect(c.notPreventable).toBe(true);
    expect(c.notPreventableDesc).toBe("Struck while parked");
    expect(c.usdotNumber).toBe("43586");
  });

  it("falls back to uploadDOTNumber when a crash carries no censusNumber", () => {
    const r = parsePspReport({
      driverInformationResponse: { status: 0, driverRecord: { crashRecords: [{ uploadDOTNumber: "999" }] } },
    });
    expect(r.crashes[0]!.usdotNumber).toBe("999");
  });

  /**
   * §8.3: a record with no crashes and no inspections IS a valid record. The UI must say "clean",
   * never "no data found" — opposite claims about the same bytes, and one is an accusation.
   */
  it("calls an empty success clean, and a failure not clean", () => {
    const clean = parsePspReport({ driverInformationResponse: { status: 0, driverRecord: {} } });
    expect(clean.outcome).toBe("success");
    expect(isCleanRecord(clean)).toBe(true);

    const failure = parsePspReport({ driverInformationResponse: { status: 1, statusDetail: 1 } });
    expect(failure.outcome).toBe("failure");
    expect(failure.billed).toBe(true);
    expect(isCleanRecord(failure)).toBe(false);
  });

  /** The OpenAPI marks nothing required, so an absent status is a shape the vendor may send. */
  it("does not guess when the status is missing", () => {
    const r = parsePspReport({ driverInformationResponse: {} });
    expect(r.outcome).toBe("unknown");
    expect(r.billed).toBe(true);
  });

  it("survives a body that is not the shape at all", () => {
    for (const junk of [null, undefined, "nope", 7, []]) {
      const r = parsePspReport(junk);
      expect(r.outcome).toBe("unknown");
      expect(r.inspections).toEqual([]);
      expect(r.crashes).toEqual([]);
    }
  });
});
