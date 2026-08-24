import { describe, it, expect } from "vitest";
import { unitResolver, driverResolver } from "./entityLookup.js";

/**
 * The two keys the ingests outside the roster module were getting wrong (D-FG7, D-FG8).
 *
 * Pure, because the rules are the interesting part and neither needs a database: which identifier
 * names a driver, how a unit number is compared, and what happens when an answer is ambiguous.
 */
describe("unitResolver", () => {
  const trailers = [
    { id: "t-reefer", unit_number: "R532159" }, // FuelGuard's prefixed form
    { id: "t-van", unit_number: "480221" },
  ];

  it("matches McLeod's unprefixed reefer number to FuelGuard's prefixed one", () => {
    // The measured gap: normalising lifted roster trailer matching from 157 of 235 to 201.
    expect(unitResolver(trailers, "trailers").get("532159")).toBe("t-reefer");
  });

  it("still matches the prefixed form, so a Samsara-quoted unit keeps working", () => {
    expect(unitResolver(trailers, "trailers").get("R532159")).toBe("t-reefer");
  });

  it("ignores surrounding whitespace and case — McLeod's char(8) columns arrive padded", () => {
    expect(unitResolver(trailers, "trailers").get("  r532159 ")).toBe("t-reefer");
    expect(unitResolver([{ id: "v1", unit_number: "104" }], "vehicles").get(" 104 ")).toBe("v1");
  });

  it("does NOT strip a leading R that is not a prefix", () => {
    // `R` followed by a digit is the reefer convention; a unit genuinely named "RALPH" is not.
    const rows = [{ id: "x", unit_number: "RALPH" }];
    expect(unitResolver(rows, "trailers").get("ALPH")).toBeUndefined();
    expect(unitResolver(rows, "trailers").get("RALPH")).toBe("x");
  });

  it("refuses a unit number two rows both claim, rather than taking the last one", () => {
    // `R532159` and `532159` normalise to the same key. A Map.set loop would silently keep whichever
    // row came last and attach the load to the wrong trailer.
    const dupes = [
      { id: "a", unit_number: "R532159" },
      { id: "b", unit_number: "532159" },
    ];
    expect(unitResolver(dupes, "trailers").get("532159")).toBeUndefined();
  });

  it("returns nothing for an absent unit", () => {
    expect(unitResolver(trailers, "trailers").get(null)).toBeUndefined();
    expect(unitResolver(trailers, "trailers").get("")).toBeUndefined();
  });
});

describe("driverResolver", () => {
  const rows = [
    { id: "d-mcleod", employee_id: null, mcleod_driver_id: "D0001" },
    { id: "d-office", employee_id: "EMP-7", mcleod_driver_id: null },
  ];

  it("resolves the McLeod driver id — the key that actually exists", () => {
    // employee_id is populated on 0 of 271 production rows; mcleod_driver_id is the roster link.
    expect(driverResolver(rows).get("D0001")).toBe("d-mcleod");
  });

  it("still resolves employee_id, so a carrier that uses it is unaffected", () => {
    expect(driverResolver(rows).get("EMP-7")).toBe("d-office");
  });

  it("refuses a value that names one driver's employee id and another's McLeod id", () => {
    const clash = [
      { id: "a", employee_id: "X9", mcleod_driver_id: null },
      { id: "b", employee_id: null, mcleod_driver_id: "X9" },
    ];
    expect(driverResolver(clash).get("X9")).toBeUndefined();
  });

  it("returns nothing for an unknown or absent key", () => {
    expect(driverResolver(rows).get("NOPE")).toBeUndefined();
    expect(driverResolver(rows).get(undefined)).toBeUndefined();
  });
});
