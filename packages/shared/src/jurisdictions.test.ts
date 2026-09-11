import { describe, expect, it } from "vitest";
import {
  JURISDICTIONS,
  JURISDICTION_CODES,
  isJurisdictionCode,
  jurisdictionName,
  jurisdictionOptions,
  toJurisdictionCode,
} from "./jurisdictions.js";
import { normalizeStateCode } from "./samsara/location.js";

/**
 * The catalogue, and the parser that used to hold its own copy of it (D-AX5).
 *
 * The interesting assertions here are not "does the list contain Illinois". They are the two ways
 * this change could silently cost something: the Samsara address parser quietly losing a code it
 * used to recognise, and a resumed draft quietly losing the state a driver already typed.
 */

describe("the catalogue", () => {
  it("covers the fifty states, the two federal jurisdictions and the thirteen Canadian ones", () => {
    const us = JURISDICTIONS.filter((j) => j.country === "US");
    const ca = JURISDICTIONS.filter((j) => j.country === "CA");
    // 50 states + DC + PR. Counted rather than listed, so adding a 51st "state" fails here and not
    // in a picker three screens deep.
    expect(us).toHaveLength(52);
    expect(ca).toHaveLength(13);
    expect(JURISDICTIONS).toHaveLength(65);
  });

  it("has no duplicate code and no code that is not two upper-case letters", () => {
    expect(JURISDICTION_CODES.size).toBe(JURISDICTIONS.length);
    for (const j of JURISDICTIONS) expect(j.code).toMatch(/^[A-Z]{2}$/);
  });

  it("puts the code in the label, because that is what a driver types", () => {
    // A list labelled with names alone cannot be reached by somebody who thinks of their state as
    // two letters — which is how all three of these fields were filled in before there was a list.
    const illinois = jurisdictionOptions().find((o) => o.value === "IL");
    expect(illinois?.label).toBe("Illinois (IL)");
  });

  it("names a code, and says nothing rather than guessing at one it does not hold", () => {
    expect(jurisdictionName("il")).toBe("Illinois");
    expect(jurisdictionName("XX")).toBeNull();
    expect(jurisdictionName(null)).toBeNull();
  });
});

describe("reading back what is already stored", () => {
  /**
   * ⚠ The case this function exists for. Before the picker these were free-text boxes capped at two
   * characters, and a saved draft can hold any of these spellings. A picker handed one it cannot
   * place renders empty, and the driver returns to a form that has forgotten where they live.
   */
  it("places a code, a lower-case code, a full name and a lower-case name on the same jurisdiction", () => {
    expect(toJurisdictionCode("IL")).toBe("IL");
    expect(toJurisdictionCode("il")).toBe("IL");
    expect(toJurisdictionCode(" Illinois ")).toBe("IL");
    expect(toJurisdictionCode("illinois")).toBe("IL");
    expect(toJurisdictionCode("British Columbia")).toBe("BC");
  });

  it("returns null for nothing and for nonsense, so the caller decides what that means", () => {
    expect(toJurisdictionCode("")).toBeNull();
    expect(toJurisdictionCode("   ")).toBeNull();
    expect(toJurisdictionCode(null)).toBeNull();
    expect(toJurisdictionCode(undefined)).toBeNull();
    expect(toJurisdictionCode("Bavaria")).toBeNull();
  });

  it("accepts a code in any case as a code", () => {
    expect(isJurisdictionCode("tx")).toBe(true);
    expect(isJurisdictionCode("TX")).toBe(true);
    expect(isJurisdictionCode("ZZ")).toBe(false);
    expect(isJurisdictionCode(7)).toBe(false);
  });
});

describe("the Samsara parser, after its two lists were replaced by derivations", () => {
  it("derives the same 65 codes and names the Samsara parser used to write out by hand", () => {
    // `location.ts` held 65 codes and a 66-entry name map. Both are now built from JURISDICTIONS, so
    // the risk of the change is a code or a name that silently stopped resolving — which reaches
    // production as an EFS transaction that can no longer be compared to a Samsara position, and
    // shows up as "unknown location" rather than as an error.
    for (const j of JURISDICTIONS) {
      expect(normalizeStateCode(j.code)).toBe(j.code);
      expect(normalizeStateCode(j.code.toLowerCase())).toBe(j.code);
      expect(normalizeStateCode(j.name)).toBe(j.code);
      expect(normalizeStateCode(j.name.toUpperCase())).toBe(j.code);
    }
  });

  it("keeps the one alias that is not a canonical name", () => {
    // EFS statements write "Newfoundland"; the province is "Newfoundland and Labrador". It cannot be
    // derived, so it is declared — and this is what stops the next refactor dropping it.
    expect(normalizeStateCode("Newfoundland")).toBe("NL");
    expect(normalizeStateCode("Newfoundland and Labrador")).toBe("NL");
  });

  it("still refuses what it always refused", () => {
    expect(normalizeStateCode("Bavaria")).toBeNull();
    expect(normalizeStateCode("")).toBeNull();
    expect(normalizeStateCode(null)).toBeNull();
  });
});
