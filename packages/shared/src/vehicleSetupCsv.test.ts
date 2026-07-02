import { describe, it, expect } from "vitest";
import { serializeVehicleSetupCsv, parseVehicleSetupCsv, SETUP_CSV_COLUMNS } from "./index.js";

const veh = (over: Partial<Parameters<typeof serializeVehicleSetupCsv>[0][number]> = {}) => ({
  unit_number: "101",
  tank_capacity_gal: 120,
  baseline_mpg: 6.5,
  make: "Freightliner",
  model: "Cascadia",
  year: 2021,
  fuel_type: "diesel" as const,
  current_odometer: 438795,
  ...over,
});

describe("serializeVehicleSetupCsv", () => {
  it("writes a header then one row per vehicle", () => {
    const csv = serializeVehicleSetupCsv([veh(), veh({ unit_number: "102", tank_capacity_gal: 0, baseline_mpg: null })]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(SETUP_CSV_COLUMNS.join(","));
    expect(lines[1]).toBe("101,120,6.5,Freightliner,Cascadia,2021,diesel,438795");
    expect(lines[2]).toBe("102,0,,Freightliner,Cascadia,2021,diesel,438795"); // null MPG → blank
  });

  it("quotes values that contain commas", () => {
    const csv = serializeVehicleSetupCsv([veh({ model: "Cascadia, Sleeper" })]);
    expect(csv).toContain('"Cascadia, Sleeper"');
  });

  it("round-trips through the parser", () => {
    const csv = serializeVehicleSetupCsv([veh(), veh({ unit_number: "102", tank_capacity_gal: 150, baseline_mpg: 7 })]);
    const { rows, errors } = parseVehicleSetupCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ unit_number: "101", tank_capacity_gal: 120, baseline_mpg: 6.5 });
    expect(rows[1]).toMatchObject({ unit_number: "102", tank_capacity_gal: 150, baseline_mpg: 7 });
  });
});

describe("parseVehicleSetupCsv", () => {
  it("treats blank editable cells as 'leave unchanged' (null)", () => {
    const csv = "unit_number,tank_capacity_gal,baseline_mpg\n201,,\n202,100,";
    const { rows } = parseVehicleSetupCsv(csv);
    expect(rows[0]).toMatchObject({ unit_number: "201", tank_capacity_gal: null, baseline_mpg: null });
    expect(rows[1]).toMatchObject({ unit_number: "202", tank_capacity_gal: 100, baseline_mpg: null });
  });

  it("is tolerant of column order and extra columns", () => {
    const csv = "make,baseline_mpg,unit_number,tank_capacity_gal\nFreightliner,6,303,140";
    const { rows } = parseVehicleSetupCsv(csv);
    expect(rows[0]).toMatchObject({ unit_number: "303", tank_capacity_gal: 140, baseline_mpg: 6 });
  });

  it("strips $ and thousands separators from numbers", () => {
    const csv = "unit_number,tank_capacity_gal\n404,\"1,200\"";
    const { rows } = parseVehicleSetupCsv(csv);
    expect(rows[0]!.tank_capacity_gal).toBe(1200);
  });

  it("collects errors for bad numbers and negatives without dropping good rows", () => {
    const csv = "unit_number,tank_capacity_gal,baseline_mpg\n501,abc,6\n502,-5,7\n503,120,6.2";
    const { rows, errors } = parseVehicleSetupCsv(csv);
    expect(errors.some((e) => e.includes("not a number"))).toBe(true);
    expect(errors.some((e) => e.includes("negative"))).toBe(true);
    // 501 and 502 have bad cells but still produce a row (the bad cell just stays null/unchanged)
    expect(rows.find((r) => r.unit_number === "503")).toMatchObject({ tank_capacity_gal: 120, baseline_mpg: 6.2 });
  });

  it("skips rows with no unit number and flags duplicates", () => {
    const csv = "unit_number,tank_capacity_gal\n,100\n601,120\n601,130";
    const { rows, errors } = parseVehicleSetupCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unit_number).toBe("601");
    expect(errors.some((e) => e.includes("missing unit"))).toBe(true);
    expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("errors when required columns are absent", () => {
    expect(parseVehicleSetupCsv("make,model\nA,B").errors[0]).toContain("unit_number");
    expect(parseVehicleSetupCsv("unit_number,make\n1,x").errors[0]).toContain("tank_capacity_gal");
    expect(parseVehicleSetupCsv("unit_number,tank_capacity_gal").errors[0]).toContain("no data");
  });
});
