import { describe, it, expect } from "vitest";
import { declaredLicenceJurisdictions, mvrJurisdictionsOutstanding } from "./mvrJurisdictions.js";

/**
 * AF7, §391.23(a)(1): an MVR from every jurisdiction the applicant declared.
 *
 * ⚠ The fixtures deliberately mix a code and a free-text authority, because that is the draft's real
 * shape (`cdl_state` is a code, `additional_licences[].issuing_authority` is not) and a fixture of
 * two codes could not tell "compared after trim and case" from "normalised".
 */
describe("declaredLicenceJurisdictions", () => {
  it("reads the licence's state, then every additional licence's authority, as written", () => {
    expect(
      declaredLicenceJurisdictions({
        cdl_state: "IL",
        additional_licences: [
          { issuing_authority: "Indiana BMV", number: "X1" },
          { issuing_authority: " Ontario MTO ", number: "X2" },
        ],
      }),
    ).toEqual(["IL", "Indiana BMV", "Ontario MTO"]);
  });

  it("keeps the first spelling of a jurisdiction declared twice, whatever its case", () => {
    expect(
      declaredLicenceJurisdictions({
        cdl_state: "IL",
        additional_licences: [{ issuing_authority: "il" }, { issuing_authority: "Illinois" }],
      }),
    ).toEqual(["IL", "Illinois"]);
  });

  it("reads nothing declared from a draft that has no licence yet, or holds something malformed", () => {
    expect(declaredLicenceJurisdictions(null)).toEqual([]);
    expect(declaredLicenceJurisdictions({})).toEqual([]);
    expect(declaredLicenceJurisdictions({ cdl_state: "  ", additional_licences: "IN" })).toEqual([]);
    expect(declaredLicenceJurisdictions({ cdl_state: 7, additional_licences: [null, "IN", {}] })).toEqual([]);
  });
});

describe("mvrJurisdictionsOutstanding", () => {
  it("names every declared jurisdiction no MVR was recorded for, in declaration order", () => {
    expect(mvrJurisdictionsOutstanding(["IL", "Indiana BMV", "WI"], ["WI"])).toEqual(["IL", "Indiana BMV"]);
  });

  it("matches after trimming and case, and after nothing else", () => {
    expect(mvrJurisdictionsOutstanding(["IL", "Indiana BMV"], [" il ", "INDIANA BMV"])).toEqual([]);
    // ⚠ The refusal the header argues for: a state's name is not its code, and deciding they are
    // one agency is a person's call on a federal requirement, not this function's.
    expect(mvrJurisdictionsOutstanding(["IL"], ["Illinois"])).toEqual(["IL"]);
  });

  it("does not let an MVR recorded without a jurisdiction cover a declared one", () => {
    expect(mvrJurisdictionsOutstanding(["IL"], [null, undefined, ""])).toEqual(["IL"]);
  });

  it("owes nothing while nothing is declared", () => {
    expect(mvrJurisdictionsOutstanding([], [])).toEqual([]);
  });
});
