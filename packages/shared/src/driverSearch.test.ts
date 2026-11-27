import { describe, expect, it } from "vitest";
import { driverSearchRank, matchesDriverSearch, unitsByDriver, type DriverSearchFields } from "./driverSearch.js";

const leonard: DriverSearchFields = { names: ["LEONARD BURRELL", "leonard"], units: ["676"], phones: ["(312) 555-0134"] };
// Production's case (2026-11-23): another driver whose PHONE holds the digits 676.
const other: DriverSearchFields = { names: ["JANE ROE"], units: ["412"], phones: ["(773) 676-2210"] };

describe("driverSearchRank", () => {
  it("finds a driver by his truck and not the driver whose phone holds the same digits", () => {
    expect(matchesDriverSearch("676", leonard)).toBe(true);
    expect(matchesDriverSearch("676", other)).toBe(false);
  });

  it("matches a unit as a whole token or the start of one, never in the middle", () => {
    expect(matchesDriverSearch("676", { names: [], units: ["1676"] })).toBe(false);
    expect(matchesDriverSearch("676", { names: [], units: ["676 - OLD"] })).toBe(true);
    expect(matchesDriverSearch("67", { names: [], units: ["676"] })).toBe(true);
    expect(matchesDriverSearch("76", { names: [], units: ["676"] })).toBe(false);
  });

  it("ranks an exact unit before a unit it only starts", () => {
    expect(driverSearchRank("676", leonard)).toBe(0);
    expect(driverSearchRank("67", leonard)).toBe(1);
  });

  it("reads a leading truck, unit or # as 'this is a unit' and matches units only", () => {
    expect(matchesDriverSearch("truck 676", leonard)).toBe(true);
    expect(matchesDriverSearch("Unit 676", leonard)).toBe(true);
    expect(matchesDriverSearch("#676", leonard)).toBe(true);
    expect(matchesDriverSearch("truck 676", other)).toBe(false);
    // A name is not a unit, even when the reader writes "truck" before it.
    expect(matchesDriverSearch("truck leonard", leonard)).toBe(false);
  });

  it("matches names as a substring, case-insensitive, starts of words first", () => {
    expect(driverSearchRank("burr", leonard)).toBe(2);
    expect(driverSearchRank("urrell", leonard)).toBe(3);
    expect(matchesDriverSearch("LEONARD b", leonard)).toBe(true);
    expect(matchesDriverSearch("smith", leonard)).toBe(false);
  });

  it("matches a phone by digits only from four digits, whatever the punctuation", () => {
    expect(matchesDriverSearch("555-0134", leonard)).toBe(true);
    expect(matchesDriverSearch("3125550134", leonard)).toBe(true);
    expect(matchesDriverSearch("(312) 555", leonard)).toBe(true);
    expect(matchesDriverSearch("555", leonard)).toBe(false);
    expect(matchesDriverSearch("0134", leonard)).toBe(true);
  });

  it("matches an employee ID as an identifier, not inside it", () => {
    const f: DriverSearchFields = { names: ["A"], ids: ["E-1676"] };
    expect(matchesDriverSearch("1676", f)).toBe(true);
    expect(matchesDriverSearch("676", f)).toBe(false);
  });

  it("an empty term or a bare 'truck' matches everybody", () => {
    expect(matchesDriverSearch("  ", other)).toBe(true);
    expect(matchesDriverSearch("truck ", other)).toBe(true);
  });

  it("skips empty and missing fields", () => {
    expect(matchesDriverSearch("676", { names: [null, ""], units: [undefined, " "], phones: [null] })).toBe(false);
  });
});

describe("unitsByDriver", () => {
  const v = (unit_number: string, assigned_driver_id: string | null, co_driver_id: string | null, status = "active") =>
    ({ unit_number, assigned_driver_id, co_driver_id, status }) as Parameters<typeof unitsByDriver>[0][number];

  it("seats a driver in either seat, leaves retired trucks out, and sorts units as numbers", () => {
    const map = unitsByDriver([v("1010", "a", "b"), v("99", "a", null), v("500", "c", null, "retired"), v(" ", "d", null)]);
    expect(map.get("a")).toEqual(["99", "1010"]);
    expect(map.get("b")).toEqual(["1010"]);
    expect(map.has("c")).toBe(false);
    expect(map.has("d")).toBe(false);
  });
});
