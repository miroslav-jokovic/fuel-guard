import { describe, expect, it } from "vitest";
import { buildIftaReturnReport, NO_TRUCK_LABEL, type IftaQuarterFillRaw, type IftaReturnInput, type IftaTruckStateMilesRaw } from "./returnReport.js";
import { computeIftaPosition } from "./position.js";
import { metersFromMiles } from "../smartFueling/units.js";
import type { IftaReceiptRaw } from "./receipts.js";

/**
 * The IFTA return export, as data (IP9). What matters most: every grid's totals ARE the return's
 * figures, the gallons are exactly the fills listed, a dropped duplicate is listed rather than lost,
 * and the file says where it and the IFTA page disagree.
 */
const miles = (vehicleId: string, jurisdiction: string, taxable: number, total = taxable): IftaTruckStateMilesRaw => ({
  vehicleId, jurisdiction, taxableMeters: metersFromMiles(taxable), totalMeters: metersFromMiles(total),
});
let n = 0;
const fill = (vehicleId: string | null, state: string, gallons: number, over: Partial<IftaQuarterFillRaw> = {}): IftaQuarterFillRaw => ({
  id: `f${++n}`, vehicleId, state, businessDate: "2026-08-02", fueledAt: "2026-08-02T15:00:00Z", gallons,
  pricePerGal: 3.5, totalCost: gallons * 3.5, location: "Pilot #1", ...over,
});
const receipt = (externalId: string, over: Partial<IftaReceiptRaw> = {}): IftaReceiptRaw => ({
  externalId, source: "fuel_app", vehicleId: "v512", unitAsFiled: "512", jurisdiction: "OK", receiptDate: "2026-08-03", gallons: 200, ...over,
});

function input(over: Partial<IftaReturnInput> = {}): IftaReturnInput {
  return {
    year: 2026, quarter: 3,
    truckMiles: [miles("v101", "TX", 3_000.4), miles("v101", "OK", 500.3), miles("v512", "OK", 1_400.3, 1_450), miles("v512", "TX", 0.4)],
    cardFills: [fill("v101", "TX", 400), fill("v101", "ok", 100.25)],
    receipts: [receipt("r1")],
    units: { v101: "101", v512: "512" },
    ledger: null,
    ...over,
  };
}

describe("buildIftaReturnReport", () => {
  it("makes each state's column total the miles and gallons its return line was priced on", () => {
    const r = buildIftaReturnReport(input());
    expect(r.jurisdictions).toEqual(["OK", "TX"]);
    for (const j of r.position.jurisdictions) {
      expect(Math.round(r.columnTotals.taxableMiles[j.jurisdiction] ?? 0)).toBe(j.taxableMiles);
      expect(Math.round((r.columnTotals.gallons[j.jurisdiction] ?? 0) * 10) / 10).toBe(j.gallonsPurchased);
    }
    // Unrounded on the way through: 500.3 + 1,400.3 is 1,900.6, which a sum of whole-mile cells
    // (500 + 1,400) would print as 1,900 under a return line of 1,901.
    expect(r.columnTotals.taxableMiles.OK).toBeCloseTo(1_900.6, 6);
    expect(r.position.jurisdictions.find((j) => j.jurisdiction === "OK")!.taxableMiles).toBe(1_901);
  });

  it("puts trucks in unit order with their row totals and MPG, and the receipt on its truck", () => {
    const r = buildIftaReturnReport(input());
    expect(r.trucks.map((t) => t.truck)).toEqual(["101", "512"]);
    const [t101, t512] = r.trucks;
    expect(t101!.totalTaxableMiles).toBeCloseTo(3_500.7, 6);
    expect(t101!.totalGallons).toBeCloseTo(500.25, 6);
    expect(t101!.mpg).toBeCloseTo(3_500.7 / 500.25, 6);
    expect(t512!.gallons).toEqual({ OK: 200 });
    expect(t512!.mpg).toBeCloseTo(1_400.7 / 200, 6);
    expect(t512!.fills).toEqual({ OK: 1 });
    expect(t512!.totalMiles).toBeCloseTo(1_450.4, 6);
  });

  it("lists exactly the fills the gallons are made of, each with its source", () => {
    const r = buildIftaReturnReport(input());
    expect(r.fills.map((f) => [f.truck, f.jurisdiction, f.gallons, f.source])).toEqual([
      ["101", "TX", 400, "card"],
      ["101", "OK", 100.25, "card"],
      ["512", "OK", 200, "fuel_app"],
    ]);
    const listed = r.fills.reduce((s, f) => s + f.gallons, 0);
    expect(listed).toBeCloseTo(r.position.mpg.totalGallons, 9);
    expect(r.position.receiptGallons).toBe(200);
  });

  it("drops a receipt a card fill already carries, and lists it as dropped instead of losing it", () => {
    const r = buildIftaReturnReport(input({
      cardFills: [fill("v512", "OK", 100.3, { businessDate: "2026-08-03" })],
      // The fuel app's file names no unit, so the dropped line takes its truck's.
      receipts: [receipt("r1", { gallons: 100, unitAsFiled: "" }), receipt("r2", { source: "mcleod", gallons: 60, receiptDate: "2026-08-20" })],
    }));
    expect(r.fills.map((f) => [f.source, f.gallons])).toEqual([["card", 100.3], ["mcleod", 60]]);
    expect(r.issues.filter((i) => i.kind === "duplicate_dropped")).toEqual([
      expect.objectContaining({ truck: "512", jurisdiction: "OK", day: "2026-08-03", figure: 100 }),
    ]);
  });

  it("keeps fuel with no truck in its state, on the no-truck row, and says so", () => {
    const r = buildIftaReturnReport(input({
      // A unit that sorts after "No truck" by its letters, so the row is last by rule, not by luck.
      truckMiles: [...input().truckMiles, miles("vtr", "TX", 10)],
      units: { v101: "101", v512: "512", vtr: "TR-77" },
      cardFills: [fill(null, "TX", 50)],
      receipts: [receipt("r1", { vehicleId: null, unitAsFiled: "999", jurisdiction: "AR", gallons: 100 })],
    }));
    expect(r.trucks.map((t) => t.truck)).toEqual(["101", "512", "TR-77", NO_TRUCK_LABEL]);
    const last = r.trucks[r.trucks.length - 1]!;
    expect(last).toMatchObject({ vehicleId: null, truck: NO_TRUCK_LABEL, gallons: { TX: 50, AR: 100 }, mpg: null });
    expect(r.columnTotals.gallons).toMatchObject({ TX: 50, AR: 100 });
    expect(r.fills.map((f) => f.truck)).toEqual([NO_TRUCK_LABEL, `${NO_TRUCK_LABEL} (unit 999 as filed)`]);
    expect(r.issues.filter((i) => i.kind === "fuel_without_truck").map((i) => i.jurisdiction).sort()).toEqual(["AR", "TX"]);
  });

  it("names a truck that drove and bought nothing, and one whose MPG no tractor gets", () => {
    const r = buildIftaReturnReport(input({
      truckMiles: [miles("v101", "TX", 3_000), miles("v512", "OK", 1_400), miles("v718", "TX", 900)],
      cardFills: [fill("v101", "TX", 200)],
      receipts: [receipt("r1", { gallons: 400 })],
      units: { v101: "101", v512: "512", v718: "718" },
    }));
    expect(r.issues.map((i) => [i.kind, i.truck])).toEqual([
      ["miles_without_fuel", "718"],
      ["truck_mpg_implausible", "101"],
    ]);
    expect(r.issues[1]!.detail).toContain("15.00 mpg");
  });

  it("says nothing about a quarter that hangs together", () => {
    const r = buildIftaReturnReport(input({
      truckMiles: [miles("v101", "TX", 3_500)],
      cardFills: [fill("v101", "TX", 500)],
      receipts: [],
    }));
    expect(r.issues).toEqual([]);
  });

  it("lists a state where the IFTA page shows different figures, and only that state", () => {
    const base = buildIftaReturnReport(input());
    const ledger = computeIftaPosition(
      [
        { jurisdiction: "TX", taxableMeters: metersFromMiles(3_000.8), totalMeters: 0, taxPaidLiters: 0 },
        { jurisdiction: "OK", taxableMeters: metersFromMiles(1_900.6), totalMeters: 0, taxPaidLiters: 0 },
      ],
      [{ jurisdiction: "TX", gallons: 400, tranDate: "2026-08-15" }, { jurisdiction: "OK", gallons: 150.25, tranDate: "2026-08-15" }],
      "2026-08-15",
    );
    expect(buildIftaReturnReport(input({ ledger: base.position })).issues.filter((i) => i.kind === "ledger_disagrees")).toEqual([]);
    const r = buildIftaReturnReport(input({ ledger }));
    expect(r.issues.filter((i) => i.kind === "ledger_disagrees").map((i) => i.jurisdiction)).toEqual(["OK"]);
    expect(r.issues.find((i) => i.kind === "ledger_disagrees")!.detail).toContain("150.3 gal");
  });

  it("puts the fleet MPG warning first, because every tax figure rests on it", () => {
    const r = buildIftaReturnReport(input({
      truckMiles: [miles("v101", "TX", 30_000)],
      cardFills: [fill("v101", "TX", 1_000)],
      receipts: [],
    }));
    expect(r.issues[0]).toMatchObject({ kind: "fleet_mpg" });
    expect(r.issues[0]!.detail).toContain("no tractor achieves");
  });
});
