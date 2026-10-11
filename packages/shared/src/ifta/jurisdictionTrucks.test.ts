import { describe, expect, it } from "vitest";
import { iftaJurisdictionTrucks } from "./jurisdictionTrucks.js";
import { metersFromMiles } from "../smartFueling/units.js";

const truck = (unitNumber: string | null, taxableMiles: number, totalMiles = taxableMiles, months = 3) => ({
  vehicleId: `v-${unitNumber ?? "none"}`,
  unitNumber,
  taxableMeters: metersFromMiles(taxableMiles),
  totalMeters: metersFromMiles(totalMiles),
  months,
});

describe("iftaJurisdictionTrucks", () => {
  it("converts each truck's metres to miles and totals the jurisdiction", () => {
    const r = iftaJurisdictionTrucks([truck("101", 1_200, 1_250), truck("102", 800)]);
    expect(r.trucks.map((t) => [t.unitNumber, t.taxableMiles, t.totalMiles])).toEqual([
      ["101", 1_200, 1_250],
      ["102", 800, 800],
    ]);
    expect(r.taxableMiles).toBe(2_000);
    expect(r.totalMiles).toBe(2_050);
  });

  it("gives each truck its share of the jurisdiction's TAXABLE miles, not of its total miles", () => {
    // 102's total is inflated by non-taxable (toll / off-highway) miles; its share must not be.
    const r = iftaJurisdictionTrucks([truck("101", 750), truck("102", 250, 5_000)]);
    expect(r.trucks.find((t) => t.unitNumber === "101")!.share).toBeCloseTo(0.75, 6);
    expect(r.trucks.find((t) => t.unitNumber === "102")!.share).toBeCloseTo(0.25, 6);
  });

  it("orders the most taxable miles first, unit number breaking a tie", () => {
    const r = iftaJurisdictionTrucks([truck("20", 100), truck("9", 100), truck("5", 900)]);
    expect(r.trucks.map((t) => t.unitNumber)).toEqual(["5", "9", "20"]);
  });

  it("keeps a truck with no unit number rather than dropping its miles", () => {
    const r = iftaJurisdictionTrucks([truck(null, 400), truck("101", 600)]);
    expect(r.trucks).toHaveLength(2);
    expect(r.taxableMiles).toBe(1_000);
  });

  it("has no share at all when the jurisdiction has no taxable miles, rather than dividing by zero", () => {
    const r = iftaJurisdictionTrucks([truck("101", 0, 300)]);
    expect(r.trucks[0]!.share).toBeNull();
    expect(r.totalMiles).toBe(300);
  });

  it("totals from unrounded miles, so many small trucks do not drift from the ledger's row", () => {
    // Ten trucks of 0.4 mi each: rounding first would total 0, the ledger's sum says 4.
    const r = iftaJurisdictionTrucks(Array.from({ length: 10 }, (_, i) => truck(String(i), 0.4)));
    expect(r.taxableMiles).toBe(4);
  });
});

const fill = (vehicleId: string | null, gallons: number, totalCost: number | null, fueledAt: string) => ({
  id: `f-${vehicleId}-${fueledAt}`, vehicleId, fueledAt, businessDate: fueledAt.slice(0, 10),
  gallons, pricePerGal: totalCost == null ? null : totalCost / gallons, totalCost, location: "Pilot #123, Amarillo TX",
});

describe("iftaJurisdictionTrucks — the fuel bought there", () => {
  it("puts each fill on the truck that bought it, newest first, with its gallons and spend", () => {
    const r = iftaJurisdictionTrucks(
      [truck("101", 1_000)],
      [fill("v-101", 100, 380, "2026-07-02T10:00:00Z"), fill("v-101", 120.5, 450, "2026-08-09T10:00:00Z")],
    );
    const t = r.trucks[0]!;
    expect(t.gallonsBought).toBe(220.5);
    expect(t.spent).toBe(830);
    expect(t.fills.map((f) => f.fueledAt)).toEqual(["2026-08-09T10:00:00Z", "2026-07-02T10:00:00Z"]);
  });

  it("keeps a truck that fuelled here without reporting miles here, below every truck that drove here", () => {
    const r = iftaJurisdictionTrucks(
      [truck("101", 50)],
      [fill("v-777", 150, 600, "2026-07-03T10:00:00Z")],
      { "v-777": "777" },
    );
    expect(r.trucks.map((t) => [t.unitNumber, t.taxableMiles, t.gallonsBought])).toEqual([
      ["101", 50, 0],
      ["777", 0, 150],
    ]);
  });

  it("keeps fills with no truck as their own last row, so the page's gallons equal the ledger row's", () => {
    const r = iftaJurisdictionTrucks(
      [truck("101", 1_000)],
      [fill("v-101", 100, 400, "2026-07-02T10:00:00Z"), fill(null, 80, 300, "2026-07-05T10:00:00Z")],
    );
    expect(r.gallonsBought).toBe(180);
    expect(r.fillCount).toBe(2);
    const last = r.trucks[r.trucks.length - 1]!;
    expect(last.vehicleId).toBeNull();
    expect(last.gallonsBought).toBe(80);
    expect(r.trucks.reduce((a, t) => a + t.gallonsBought, 0)).toBe(r.gallonsBought);
  });

  it("counts a fill with no recorded cost as no spend rather than NaN", () => {
    const r = iftaJurisdictionTrucks([truck("101", 10)], [fill("v-101", 50, null, "2026-07-02T10:00:00Z")]);
    expect(r.spent).toBe(0);
    expect(r.trucks[0]!.gallonsBought).toBe(50);
  });

  describe("receipts keyed in McLeod (IP6)", () => {
    const receipt = (externalId: string, vehicleId: string | null, gallons: number, receiptDate: string, unitAsFiled = "512") => ({
      externalId, source: "mcleod" as const, vehicleId, unitAsFiled, jurisdiction: "TX", receiptDate, gallons,
    });

    it("lists a truck whose only fuel here was a receipt as a truck that bought fuel here", () => {
      const r = iftaJurisdictionTrucks(
        [truck("101", 1_000)],
        [fill("v-101", 100, 400, "2026-07-02T10:00:00Z")],
        { "v-512": "512" },
        [receipt("r1", "v-512", 120, "2026-08-15"), receipt("r2", "v-512", 30, "2026-09-01")],
      );
      const t512 = r.trucks.find((t) => t.unitNumber === "512")!;
      expect(t512).toMatchObject({ vehicleId: "v-512", taxableMiles: 0, gallonsBought: 150, spent: 0 });
      expect(t512.fills.map((f) => [f.businessDate, f.source, f.fueledAt, f.pricePerGal, f.totalCost])).toEqual([
        ["2026-09-01", "mcleod_receipt", null, null, null],
        ["2026-08-15", "mcleod_receipt", null, null, null],
      ]);
    });

    it("puts receipts in the jurisdiction's gallons, so the page still equals the ledger row", () => {
      const r = iftaJurisdictionTrucks(
        [truck("101", 1_000)],
        [fill("v-101", 100, 400, "2026-07-02T10:00:00Z")],
        {},
        [receipt("r1", "v-101", 20, "2026-07-20"), receipt("r2", null, 40, "2026-08-01", "999")],
      );
      expect(r).toMatchObject({ gallonsBought: 160, fillCount: 1, receiptCount: 2, receiptGallons: 60, spent: 400 });
      expect(r.trucks.reduce((a, t) => a + t.gallonsBought, 0)).toBe(r.gallonsBought);
    });

    it("keeps a receipt from a McLeod unit we do not have on the no-truck row, naming the unit", () => {
      const r = iftaJurisdictionTrucks([truck("101", 1_000)], [], {}, [receipt("r9", null, 40, "2026-08-01", "999")]);
      const last = r.trucks[r.trucks.length - 1]!;
      expect(last.vehicleId).toBeNull();
      expect(last.fills[0]!.location).toBe("McLeod unit 999, matched to no truck");
    });
  });
});
