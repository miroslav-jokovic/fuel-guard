import { describe, expect, it } from "vitest";
import { composeFiledApplication, type PartOneFacts, type PartOneLicence } from "./applicationComposition.js";

/** D-AW3 / AW2 (C2c): the filed payload is the certified application with Part 1 laid over it. */
const AS_OF = "2026-09-26";

const application = () => ({
  phone: "555-0111",
  addresses: [
    { line1: "9 Old Rd", line2: null, city: "Gary", state: "IN", postal_code: "46402", from: "2020-01", to: "2024-05" },
    { line1: "typed street", line2: "Apt 1", city: "typed city", state: "XX", postal_code: "00000", from: "2024-06", to: null },
  ],
  cdl_number: "TYPED1", cdl_state: "WI", cdl_expires_at: "2027-01-01",
  additional_licences: [{ issuing_authority: "Ohio", number: "DRAFT9", expires_at: "2030-01-01", kind: "permit" }],
  prior_failed_pre_employment_test: null as boolean | null,
});

const intake = (over: Partial<PartOneFacts> = {}): PartOneFacts => ({
  phone: "+13125550142",
  address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL", postal_code: "60431",
  prior_positive_2y: false,
  ...over,
});

const licence = (over: Partial<PartOneLicence> = {}): PartOneLicence => ({
  position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01", ...over,
});

describe("composeFiledApplication", () => {
  it("files Part 1's phone, current street and §40.25(j) answer over what the draft held", () => {
    const { application: out, issues } = composeFiledApplication(application(), intake(), [licence()], AS_OF);
    expect(issues).toEqual([]);
    expect(out.phone).toBe("+13125550142");
    expect(out.prior_failed_pre_employment_test).toBe(false);
    expect(out.addresses[1]).toEqual({
      line1: "1 Main St", line2: null, city: "Joliet", state: "IL", postal_code: "60431", from: "2024-06", to: null,
    });
    // The earlier address is history, and Part 1 records only where they live now.
    expect(out.addresses[0]!.line1).toBe("9 Old Rd");
  });

  it("files position 0 as the primary licence and only the unexpired others as (b)(5)'s list, replacing the draft's", () => {
    const { application: out } = composeFiledApplication(application(), intake(), [
      licence({ position: 2, state_code: "IN", licence_number: "IN-OLD", expires_on: "2025-01-01" }),
      licence(),
      licence({ position: 1, state_code: "OH", agency: "Ohio BMV", licence_number: "OH55", expires_on: "2028-06-30" }),
    ], AS_OF);
    expect([out.cdl_number, out.cdl_state, out.cdl_expires_at]).toEqual(["IL123", "IL", "2029-03-01"]);
    expect(out.additional_licences).toEqual([
      { issuing_authority: "Ohio BMV", number: "OH55", expires_at: "2028-06-30", kind: null },
    ]);
  });

  it("names a licence with no expiry rather than dropping it", () => {
    const { issues } = composeFiledApplication(application(), intake(), [
      licence(), licence({ position: 1, state_code: "OH", licence_number: "OH55", expires_on: null }),
    ], AS_OF);
    expect(issues).toEqual([{ path: "additional_licences", message: "Give the expiry date of your OH licence" }]);
  });

  it("leaves what Part 1 never answered as the applicant certified it", () => {
    const blank = intake({ phone: null, address_line1: null, prior_positive_2y: null });
    const { application: out } = composeFiledApplication(application(), blank, [], AS_OF);
    expect(out).toEqual(application());
  });
});
