import { describe, it, expect } from "vitest";
import {
  declaredLicenceJurisdictions,
  mvrJurisdictionOptions,
  mvrJurisdictionsOutstanding,
} from "./mvrJurisdictions.js";
import { JURISDICTIONS } from "./jurisdictions.js";

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

  it("counts a state once however it was written, and names it by its code (Q-AF5)", () => {
    expect(
      declaredLicenceJurisdictions({
        cdl_state: "IL",
        additional_licences: [
          { issuing_authority: "il" },
          { issuing_authority: " Illinois " },
          { issuing_authority: "indiana" },
          { issuing_authority: "Indiana BMV" },
          { issuing_authority: "indiana bmv" },
        ],
      }),
    ).toEqual(["IL", "IN", "Indiana BMV"]);
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

  it("matches a state by its name or its code, through the one catalogue (Q-AF5)", () => {
    expect(mvrJurisdictionsOutstanding(["IL", "Ontario"], ["illinois", "ON"])).toEqual([]);
    expect(mvrJurisdictionsOutstanding(["Illinois"], [" il "])).toEqual([]);
  });

  it("compares what the catalogue cannot place after trim and case, and nothing more", () => {
    expect(mvrJurisdictionsOutstanding(["Indiana BMV"], ["  INDIANA bmv "])).toEqual([]);
    // ⚠ The line the header draws: an agency's name is not read as the state it sits in.
    expect(mvrJurisdictionsOutstanding(["Indiana BMV"], ["IN"])).toEqual(["Indiana BMV"]);
    expect(mvrJurisdictionsOutstanding(["IN"], ["Indiana BMV"])).toEqual(["IN"]);
  });

  it("does not let an MVR recorded without a jurisdiction cover a declared one", () => {
    expect(mvrJurisdictionsOutstanding(["IL"], [null, undefined, ""])).toEqual(["IL"]);
  });

  it("owes nothing while nothing is declared", () => {
    expect(mvrJurisdictionsOutstanding([], [])).toEqual([]);
  });
});

describe("mvrJurisdictionOptions", () => {
  it("offers what is still owed first, as values the fold will match, then every other jurisdiction", () => {
    const options = mvrJurisdictionOptions(["IN", "Indiana BMV"]);
    expect(options.slice(0, 2)).toEqual([
      { value: "IN", label: "Indiana (IN) — still needed" },
      { value: "Indiana BMV", label: "Indiana BMV — still needed" },
    ]);
    // Every catalogue jurisdiction is still offered exactly once.
    expect(options.filter((o) => o.value === "IN")).toHaveLength(1);
    expect(options).toHaveLength(JURISDICTIONS.length + 1);
    for (const o of options.slice(0, 2)) {
      expect(mvrJurisdictionsOutstanding(["IN", "Indiana BMV"], [o.value])).toHaveLength(1);
    }
  });

  it("offers a state owed under its name as the code every state field stores", () => {
    expect(mvrJurisdictionOptions([" indiana "])[0]).toEqual({ value: "IN", label: "Indiana (IN) — still needed" });
  });

  it("is the catalogue alone when nothing is owed", () => {
    expect(mvrJurisdictionOptions([])).toHaveLength(JURISDICTIONS.length);
  });
});
