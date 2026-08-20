import { describe, it, expect } from "vitest";
import { buildPspDraft, pspNameParts, resolveCarrierIdentity } from "./identity.js";
import { screeningReadiness, screeningFieldLabel } from "./readiness.js";
import { validatePspRequest } from "./validate.js";

const TODAY = "2026-08-20";

const driver = (over: Partial<Parameters<typeof buildPspDraft>[0]["driver"]> = {}) => ({
  id: "d1",
  first_name: "SUSAN",
  last_name: "GODFREY",
  full_name: "Susan Godfrey",
  date_of_birth: "1949-12-11",
  cdl_number: "PA334554",
  cdl_state: "PA",
  ...over,
});

/**
 * The UAT account is a DIFFERENT CARRIER, and this is the case that would have broken every test
 * request. `organizations.dot_number` holds Silvicom's real USDOT number (1864495), which identifies
 * them to FMCSA in production and nowhere else; PSP's test environment issued a separate account,
 * "Silvicom, Inc - UAT", with its own motorCarrierId (31496).
 *
 * Before `environment` existed the org row won unconditionally and returned `motorCarrierId: null`,
 * so a UAT request would have sent the production USDOT, silently discarded 31496, and come back
 * §8.5 detail 18 — "the Motor Carrier ID or DOT Number provided is not correct" — on every driver,
 * with nothing in the error naming the cause.
 */
describe("who the carrier is — in UAT", () => {
  it("ignores the organisation's real DOT number entirely — that carrier does not exist in UAT", () => {
    const carrier = resolveCarrierIdentity({
      orgDotNumber: "1864495",
      envMotorCarrierId: "31496",
      environment: "uat",
    });
    expect(carrier).toEqual({ dotNumber: null, motorCarrierId: "31496", source: "environment" });
  });

  it("uses the test account's own credentials, which travel with its token", () => {
    const carrier = resolveCarrierIdentity({ envMotorCarrierId: "31496", environment: "uat" });
    expect(carrier.motorCarrierId).toBe("31496");
    expect(carrier.source).toBe("environment");
  });

  /** With nothing configured the gate refuses on §8.5 detail 10 rather than sending a blank. */
  it("reports none when the test account's identity was never configured", () => {
    expect(resolveCarrierIdentity({ orgDotNumber: "1864495", environment: "uat" }).source).toBe("none");
  });
});

describe("who the carrier is — in PRODUCTION", () => {
  /**
   * The org wins. An environment-level DOT number files every request under one carrier, and with
   * two organisations in the database that means one org's driver screened under the other's
   * account-holder agreement — a misattribution, not a cosmetic default.
   */
  it("prefers the organisation's own DOT number", () => {
    const carrier = resolveCarrierIdentity({ orgDotNumber: "1864495", envDotNumber: "43586", environment: "production" });
    expect(carrier).toEqual({ dotNumber: "1864495", motorCarrierId: null, source: "organization" });
  });

  it("falls back to the environment for an org that has not filled one in", () => {
    const carrier = resolveCarrierIdentity({ orgDotNumber: null, envDotNumber: "43586", environment: "production" });
    expect(carrier.dotNumber).toBe("43586");
    expect(carrier.source).toBe("environment");
  });

  it("treats blank and whitespace as absent, not as an identity", () => {
    expect(resolveCarrierIdentity({ orgDotNumber: "   ", envDotNumber: "", environment: "production" }).source).toBe("none");
    expect(resolveCarrierIdentity({ environment: "production" }).dotNumber).toBeNull();
  });

  it("carries a Motor Carrier ID when that is all the environment has", () => {
    const carrier = resolveCarrierIdentity({ envMotorCarrierId: "MC-1", environment: "production" });
    expect(carrier).toEqual({ dotNumber: null, motorCarrierId: "MC-1", source: "environment" });
  });
});

describe("splitting a name for PSP", () => {
  it("uses the structured parts when they exist", () => {
    expect(pspNameParts(driver())).toEqual({ first: "SUSAN", last: "GODFREY" });
  });

  it("falls back to the full name, first and last token", () => {
    expect(pspNameParts(driver({ first_name: null, last_name: null, full_name: "Jose A Davis" })))
      .toEqual({ first: "Jose", last: "Davis" });
  });

  it("leaves a single-token name without a surname, for the validator to refuse", () => {
    expect(pspNameParts(driver({ first_name: null, last_name: null, full_name: "Cher" })))
      .toEqual({ first: "Cher", last: "" });
  });
});

describe("readiness is judged by the validator itself", () => {
  const carrier = resolveCarrierIdentity({ orgDotNumber: "1864495", environment: "production" });

  it("calls a complete driver ready", () => {
    const { rows, summary } = screeningReadiness([{ ...driver(), status: "active" }], carrier, TODAY);
    expect(rows[0]!.ready).toBe(true);
    expect(rows[0]!.gaps).toEqual([]);
    expect(summary.ready).toBe(1);
  });

  /** The production case on 2026-08-20: a licence, a name, and no date of birth anywhere. */
  it("names the date of birth as what is blocking a driver who has everything else", () => {
    const { rows, summary } = screeningReadiness(
      [{ ...driver({ date_of_birth: null }), status: "active" }],
      carrier,
      TODAY,
    );
    expect(rows[0]!.ready).toBe(false);
    expect(rows[0]!.gaps.map((g) => g.field)).toEqual(["driverDOB"]);
    expect(summary.blockedBy).toEqual([{ field: "driverDOB", drivers: 1 }]);
  });

  it("ranks what to fix first by how many drivers it blocks", () => {
    const { summary } = screeningReadiness(
      [
        { ...driver({ date_of_birth: null }), status: "active" },
        { ...driver({ id: "d2", date_of_birth: null, cdl_number: null }), status: "active" },
        { ...driver({ id: "d3", date_of_birth: null }), status: "applicant" },
      ],
      carrier,
      TODAY,
    );
    expect(summary.drivers).toBe(3);
    expect(summary.ready).toBe(0);
    expect(summary.blockedBy[0]).toEqual({ field: "driverDOB", drivers: 3 });
    expect(summary.blockedBy.find((b) => b.field.includes("dlNum"))?.drivers).toBe(1);
  });

  /**
   * The property that makes this report worth trusting: it agrees with the request that would
   * actually be sent, because both are built and judged by the same two functions. A screen with its
   * own checklist would eventually call a driver ready whom PSP refuses — and PSP bills on Failure.
   */
  it("agrees with the order path's own validation of the same driver", () => {
    const d = driver({ cdl_state: "XX" });
    const { rows } = screeningReadiness([{ ...d, status: "active" }], carrier, TODAY);
    const draft = buildPspDraft({ driver: d, carrier, internalRefId: d.id, consent: true });
    expect(rows[0]!.gaps.map((g) => g.field)).toEqual(
      validatePspRequest(draft, TODAY).map((i) => i.field),
    );
  });

  it("reports a missing carrier number once per driver, because it blocks all of them", () => {
    const none = resolveCarrierIdentity({ environment: "production" });
    const { summary } = screeningReadiness(
      [{ ...driver(), status: "active" }, { ...driver({ id: "d2" }), status: "active" }],
      none,
      TODAY,
    );
    expect(summary.blockedBy).toEqual([{ field: "dotNumber", drivers: 2 }]);
    expect(summary.carrierSource).toBe("none");
  });

  it("labels validator field names in words an operator would use", () => {
    expect(screeningFieldLabel("driverDOB")).toBe("Date of birth");
    expect(screeningFieldLabel("licenseQueries.0.dlNum")).toBe("Licence number");
    // An unrecognised field is shown as itself rather than hidden.
    expect(screeningFieldLabel("somethingNew")).toBe("somethingNew");
  });
});
