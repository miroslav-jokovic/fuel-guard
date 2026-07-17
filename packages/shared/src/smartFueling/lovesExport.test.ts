import { describe, it, expect } from "vitest";
import { parseLovesExport, parseLovesPriceTimestamp } from "./lovesExport";
import type { Cell } from "./pilotPriceReport";

const META: Cell[] = ["", "", "", "", "", "Fuel prices are accurate as of 01:39 PM CDT July 17, 2026. Copyright (c) 2026"];
const CATEGORY: Cell[] = ["LocationInformation", "LocationInformation", "LocationInformation", "LocationInformation", "LocationInformation", "LocationInformation", "LocationInformation", "LocationInformation", "Fuel", "Fuel", "StoreType", "Contact", "Contact", "Fuel", "Fuel", "Fuel", "Fuel", "Fuel", "Fuel", "Fuel"];
const HEADER: Cell[] = ["StoreNumber", "State", "City", "Address", "HighwayOrExit", "Zip", "Latitude", "Longitude", "DEFLanes", "ParkingSpaces", "StoreType", "Phone", "Fax", "Unleaded", "Midgrade", "Premium", "Diesel", "Blend", "Propane", "BulkDEF"];
const ROW1: Cell[] = [448, "WA", "Tacoma", "1501 33rd Ave E", "I-5 / 136B", "98424", 47.245328, -122.384434, 8, 160, "Travel Stop", "(253) 922-8884", "fax", 4.699, 5.049, 5.349, 6.089, null, 4.599, 4.589];
const ROW2: Cell[] = [454, "wa", "Napavine", "x", "I-5", 98596, 46.603206, -122.908266, 4, 80, "Travel Stop", "p", "f", 4.6, 5.0, 5.3, 5.1, null, 4.6, 4.9];
const BLANK: Cell[] = ["", "", ""];

describe("parseLovesExport", () => {
  const grid: Cell[][] = [META, CATEGORY, HEADER, ROW1, ROW2, BLANK];
  const out = parseLovesExport(grid);

  it("finds the header and parses stores + diesel/DEF prices", () => {
    expect(out.headerFound).toBe(true);
    expect(out.rows.length).toBe(2);
    const a = out.rows[0]!;
    expect(a.storeNumber).toBe("448");
    expect(a.name).toBe("Love's #448");
    expect(a.state).toBe("WA");
    expect(a.lat).toBeCloseTo(47.2453, 3);
    expect(a.exit).toBe("I-5 / 136B");
    expect(a.dieselPrice).toBe(6.089);
    expect(a.defPrice).toBe(4.589);
    expect(a.hasDiesel).toBe(true);
    expect(a.hasDef).toBe(true);
  });

  it("upper-cases state and skips trailing blank rows", () => {
    expect(out.rows[1]!.state).toBe("WA");
    expect(out.skipped).toBe(0);
  });

  it("reads the 'prices accurate as of' stamp as UTC (13:39 CDT -> 18:39Z)", () => {
    expect(out.priceObservedAt).toBe("2026-07-17T18:39:00.000Z");
  });

  it("rejects a grid that is not the Love's export", () => {
    const bad = parseLovesExport([["a", "b"], ["c", "d"]]);
    expect(bad.headerFound).toBe(false);
    expect(bad.rows.length).toBe(0);
  });
});

describe("parseLovesPriceTimestamp", () => {
  it("converts CDT local to UTC ISO", () => {
    expect(parseLovesPriceTimestamp("01:39 PM CDT July 17, 2026")).toBe("2026-07-17T18:39:00.000Z");
  });
  it("returns null on garbage", () => {
    expect(parseLovesPriceTimestamp("not a date")).toBeNull();
  });
});
