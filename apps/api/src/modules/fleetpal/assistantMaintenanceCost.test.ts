import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Ask AI's `maintenance_cost` (F21 R6b). Its header promises the route's order and refusal (coverage
 * first, no cost when `coverageIsPrintable` says no, D-FP4), every figure `readUnitCost`'s, and FleetPal
 * and McLeod kept as two named values (D-FP18). So both readers are spies: the cost fixture's totals
 * are not the sum of anything a re-summing tool could see, and the coverage fixture carries McLeod's
 * fleet-wide month beside FleetPal's.
 */
const readCoverage = vi.fn();
const readUnitCost = vi.fn();
vi.mock("./coverage.js", () => ({ readCoverage: (...a: unknown[]) => readCoverage(...a) }));
vi.mock("./unitCost.js", () => ({ readUnitCost: (...a: unknown[]) => readUnitCost(...a) }));
const { assistantMaintenanceCost, MAINTENANCE_SOURCE } = await import("./assistantMaintenanceCost.js");

const ORG = "org-1";
const NOV_10 = new Date("2026-11-10T15:00:00Z");

const month = (m: string, ratio: number | null) => ({
  month: m, fleetpalInvoiced: 215_782.05, glMaintenance: ratio === null ? null : 219_301.48, confirmedInLedger: 100_000,
  ratioLowerBound: ratio, matchedExactlyOne: 1, matchedSeveral: 0, matchedNone: 0, amountDiffers: 0,
});
const COVERAGE = { months: [month("2026-09", 0.4561), month("2026-10", 0.5123)], unmatchedUnits: 48 };
const cost = (total: number, labor: number, ids = ["fp-1", "fp-2"]) => ({
  repairs: [],
  totals: { total, parts: 1234.56, labor, fees: null, tax: 12.34, services: 99.99, laborHours: 7.25 },
  repairCount: 3, downtimeDays: 4, miles: 21_345, costPerMile: 0.1357, fleetpalUnitIds: ids,
});

const recorder = () =>
  createSupabaseRecorder({
    tables: {
      organizations: [{ operating_hours: { tz: "America/Chicago" } }],
      vehicles: [{ id: "v748", unit_number: "748" }, { id: "v512", unit_number: "512" }],
      trailers: [{ id: "t5301", unit_number: "5301" }, { id: "t512", unit_number: "512" }],
    },
  });

beforeEach(() => {
  readCoverage.mockReset();
  readUnitCost.mockReset();
  readCoverage.mockResolvedValue(COVERAGE);
  readUnitCost.mockImplementation((_a: unknown, _o: unknown, _kind: string, id: string) =>
    Promise.resolve(id === "t5301" ? cost(888.88, 0, []) : cost(4321.09, 1777.7)),
  );
});

describe("maintenance_cost — the truck page's repair bills, gated like its route", () => {
  it("defaults to the page's last 12 full months, half-open, and reads coverage then each unit", async () => {
    const rec = recorder();
    const out = (await assistantMaintenanceCost(rec.client, ORG, { units: ["748"] }, NOV_10)) as Out;
    expect(readCoverage.mock.calls[0]!.slice(1)).toEqual([ORG, "2025-11-01", "2026-11-01"]);
    expect(readUnitCost.mock.calls.map((c) => c.slice(1))).toEqual([[ORG, "tractor", "v748", "2025-11-01", "2026-11-01"]]);
    expect(out).toMatchObject({ source: MAINTENANCE_SOURCE, period: "the last 12 full months", from: "2025-11-01", to: "2026-10-31" });
    expectOrgScoped(rec, ORG);
  });

  it("a named period is asked with an exclusive end, as the route takes it", async () => {
    await assistantMaintenanceCost(recorder().client, ORG, { units: ["748"], period: "last_month" }, NOV_10);
    expect(readCoverage.mock.calls[0]!.slice(2)).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("copies the page's figures unchanged, and keeps FleetPal's labour on its own", async () => {
    const out = (await assistantMaintenanceCost(recorder().client, ORG, { units: ["748", "5301"] }, NOV_10)) as Out;
    expect(out.units).toEqual([
      {
        unit: "748", kind: "truck", fleetpal_cost: 4321.09, fleetpal_parts: 1234.56, fleetpal_labor: 1777.7, fleetpal_labor_hours: 7.25,
        fleetpal_services: 99.99, fleetpal_fees: null, fleetpal_tax: 12.34, repairs: 3, days_in_shop: 4, miles: 21_345, fleetpal_cost_per_mile: 0.1357,
      },
      expect.objectContaining({ unit: "5301", kind: "trailer", fleetpal_cost: 888.88, not_in_fleetpal: true }),
    ]);
    expect(out.fleetpal_cost_is).toMatch(/labour included/);
  });

  it("McLeod is its own value: the fleet-wide month, never a per-unit figure", async () => {
    const out = (await assistantMaintenanceCost(recorder().client, ORG, { units: ["748"] }, NOV_10)) as Out;
    expect(out.mcleod_by_month).toEqual([
      { month: "2026-09", mcleod_maintenance_fleet_wide: 219_301.48, fleetpal_invoiced_fleet_wide: 215_782.05, share_of_ledger_seen_through_fleetpal_at_least: 0.4561 },
      { month: "2026-10", mcleod_maintenance_fleet_wide: 219_301.48, fleetpal_invoiced_fleet_wide: 215_782.05, share_of_ledger_seen_through_fleetpal_at_least: 0.5123 },
    ]);
    expect(out.mcleod_note).toMatch(/no McLeod figure per unit/);
    expect(Object.keys(out.units[0]).some((k) => k.startsWith("mcleod"))).toBe(false);
    expect(out.fleetpal_units_not_matched_to_our_equipment).toBe(48);
  });

  it("refuses every cost, as the route's 409 does, when a month has no ledger total (D-FP4)", async () => {
    readCoverage.mockResolvedValue({ months: [month("2026-09", 0.45), month("2026-10", null)], unmatchedUnits: 48 });
    const out = (await assistantMaintenanceCost(recorder().client, ORG, { units: ["748"] }, NOV_10)) as Out;
    expect(readUnitCost).not.toHaveBeenCalled();
    expect(out.cost_unavailable).toMatch(/^Maintenance cost cannot be shown/);
    expect(out.months_without_a_ledger_total).toEqual(["2026-10"]);
    expect(out.units).toBeUndefined();
  });

  it("a number a truck and a trailer share is both; a stranger is named back", async () => {
    const out = (await assistantMaintenanceCost(recorder().client, ORG, { units: ["Unit 512", "999"] }, NOV_10)) as Out;
    expect(out.units.map((u: Out) => `${u.kind} ${u.unit}`)).toEqual(["truck 512", "trailer 512"]);
    // Each is read as what it is: a trailer has no IFTA miles, so reading it as a truck would invent some.
    expect(readUnitCost.mock.calls.map((c) => c.slice(2, 4))).toEqual([["tractor", "v512"], ["trailer", "t512"]]);
    expect(out.not_found).toEqual(["999"]);
  });

  it("asks for units rather than answering the fleet, and refuses when none is ours", async () => {
    expect(await assistantMaintenanceCost(recorder().client, ORG, {}, NOV_10)).toEqual({ error: "Name the truck or trailer units to report on." });
    expect(await assistantMaintenanceCost(recorder().client, ORG, { units: ["999"] }, NOV_10)).toEqual({ error: "None of the named units are in this fleet.", not_found: ["999"] });
    expect(readCoverage).not.toHaveBeenCalled();
  });
});
