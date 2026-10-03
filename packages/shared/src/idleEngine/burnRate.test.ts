import { describe, expect, it } from "vitest";
import type { DeclaredEquipment } from "../idleEquipmentDeclared.js";
import {
  IDLE_BURN_BAND_EDGES_MILLI_C,
  IDLE_BURN_LEARN_DAYS,
  IDLE_BURN_PRIOR_GAL_PER_HOUR,
  idleBurnBand,
  idleBurnBandLabel,
  idleBurnInputRows,
  idleBurnInputsArgs,
  idleBurnRateFor,
  learnIdleBurnRates,
  type IdleBurnInputRow,
} from "./burnRate.js";

/**
 * D-IE5's learner (IE4). Every fixture cell burns a DIFFERENT rate, and the two trucks of one cohort
 * burn different rates too, so a fold that averages per truck instead of summing, reads the wrong
 * cohort, or files a band one off lands on a different number.
 */
const GAL = 3785.411784;
const H = 3600;
const row = (vehicleId: string, band: number | null, hours: number, galPerHour: number, parks = 10): IdleBurnInputRow => ({
  vehicleId, band, parks, runningSec: hours * H, fuelMl: hours * galPerHour * GAL,
});
const EQ: Record<string, DeclaredEquipment> = { b1: "battery_apu", b2: "battery_apu", n1: "no_apu", u1: "not_entered" };
const equipmentOf = (id: string): DeclaredEquipment => EQ[id]!;

describe("the prior", () => {
  it("lies inside §1.4's measured September burn across the comfortable bands (0.705–0.743 gal/h)", () => {
    expect(IDLE_BURN_PRIOR_GAL_PER_HOUR).toBeGreaterThanOrEqual(0.705);
    expect(IDLE_BURN_PRIOR_GAL_PER_HOUR).toBeLessThanOrEqual(0.743);
  });
});

describe("idleBurnBand", () => {
  it("matches 0409's width_bucket: lower edge inclusive, n at or above the last", () => {
    expect(IDLE_BURN_BAND_EDGES_MILLI_C).toEqual([0, 10_000, 23_889, 32_222]);
    expect(idleBurnBand(-1)).toBe(0);
    expect(idleBurnBand(0)).toBe(1);
    expect(idleBurnBand(9_999)).toBe(1);
    expect(idleBurnBand(10_000)).toBe(2);
    expect(idleBurnBand(23_888)).toBe(2);
    expect(idleBurnBand(23_889)).toBe(3);
    expect(idleBurnBand(32_221)).toBe(3);
    expect(idleBurnBand(32_222)).toBe(4);
    expect(idleBurnBand(null)).toBeNull();
  });

  it("names every band in §1.4's words", () => {
    expect([0, 1, 2, 3, 4, null].map(idleBurnBandLabel)).toEqual([
      "Below 32 °F", "32–50 °F", "50–75 °F", "75–90 °F", "90 °F and above", "No temperature",
    ]);
  });
});

describe("learnIdleBurnRates", () => {
  // battery APU, 50–75 °F: b1 30 h at 0.70 + b2 20 h at 0.90 = 50 h, 39 gal → 0.78 (a per-truck mean says 0.80).
  // no APU, 50–75 °F: 49.99 h at 0.85 — one short of learned.
  // no APU, 75–90 °F: 80 h at 0.75. no APU, no temperature: 5 h at 1.10. not entered, 50–75: 60 h at 0.66.
  const rows = [
    row("b1", 2, 30, 0.7),
    row("b2", 2, 20, 0.9),
    row("n1", 2, 49.99, 0.85),
    row("n1", 3, 80, 0.75),
    row("n1", null, 5, 1.1),
    row("u1", 2, 60, 0.66),
  ];
  const rates = learnIdleBurnRates(rows, equipmentOf);
  const cell = (eq: DeclaredEquipment, band: number | null) => rates.cells.find((c) => c.equipment === eq && c.band === band)!;

  it("a cell's rate is its gallons over its hours, summed across trucks — not a mean of truck rates", () => {
    expect(cell("battery_apu", 2).measuredGalPerHour).toBe(0.78);
    expect(cell("battery_apu", 2)).toMatchObject({ parks: 20, runningHours: 50, gallons: 39 });
  });

  it("a cell is learned at 50 running hours exactly, and reads the prior one second short of it", () => {
    expect(cell("battery_apu", 2)).toMatchObject({ learned: true, galPerHour: 0.78 });
    expect(cell("no_apu", 2)).toMatchObject({ learned: false, galPerHour: IDLE_BURN_PRIOR_GAL_PER_HOUR, measuredGalPerHour: 0.85 });
    expect(cell("no_apu", 3)).toMatchObject({ learned: true, galPerHour: 0.75 });
  });

  it("parks with no temperature are a cell of their own that is never learned, but count in the cohort", () => {
    const unbanded = learnIdleBurnRates([row("n1", null, 500, 1.1)], equipmentOf);
    expect(unbanded.cells[0]).toMatchObject({ band: null, label: "No temperature", learned: false, galPerHour: IDLE_BURN_PRIOR_GAL_PER_HOUR });
    // no APU across bands: 49.99·0.85 + 80·0.75 + 5·1.1 = 107.99 gal over 134.99 h.
    expect(rates.cohorts.find((c) => c.equipment === "no_apu")).toMatchObject({ runningHours: 135, measuredGalPerHour: 0.8 });
  });

  it("cohorts come from the declaration the caller passes, and every truck is in the fleet total", () => {
    expect(cell("not_entered", 2)).toMatchObject({ learned: true, galPerHour: 0.66 });
    expect(rates.fleet.parks).toBe(60);
    expect(rates.fleet.runningHours).toBe(245);
  });

  it("orders cells by equipment, then band, with no temperature last", () => {
    expect(rates.cells.map((c) => `${c.equipment}:${c.band}`)).toEqual([
      "battery_apu:2", "no_apu:2", "no_apu:3", "no_apu:null", "not_entered:2",
    ]);
  });

  it("no rows: no cells, and a fleet measure with no rate rather than zero", () => {
    const none = learnIdleBurnRates([], equipmentOf);
    expect(none.cells).toEqual([]);
    expect(none.fleet).toEqual({ parks: 0, runningHours: 0, gallons: 0, measuredGalPerHour: null });
  });
});

describe("idleBurnRateFor", () => {
  const rates = learnIdleBurnRates([row("b1", 2, 60, 0.81), row("n1", 3, 10, 0.95)], equipmentOf);

  it("prices an hour at its learned cell's rate, found by the reading's band and the truck's equipment", () => {
    expect(idleBurnRateFor(rates, "battery_apu", 15_000)).toBe(0.81);
  });

  it("falls back to the prior: another cohort's band, an unlearned cell, no reading", () => {
    expect(idleBurnRateFor(rates, "no_apu", 15_000)).toBe(IDLE_BURN_PRIOR_GAL_PER_HOUR);
    expect(idleBurnRateFor(rates, "no_apu", 25_000)).toBe(IDLE_BURN_PRIOR_GAL_PER_HOUR);
    expect(idleBurnRateFor(rates, "battery_apu", 25_000)).toBe(IDLE_BURN_PRIOR_GAL_PER_HOUR);
    expect(idleBurnRateFor(rates, "battery_apu", null)).toBe(IDLE_BURN_PRIOR_GAL_PER_HOUR);
  });
});

describe("idleBurnInputsArgs / idleBurnInputRows (0409's call, shared by the office API and the console)", () => {
  it("asks for the last IDLE_BURN_LEARN_DAYS before now, the org's rows only, on the shared band edges", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    const { from, to, args } = idleBurnInputsArgs("org-1", now);
    expect(to).toBe("2026-10-03T12:00:00.000Z");
    expect(from).toBe(new Date(now.getTime() - IDLE_BURN_LEARN_DAYS * 86_400_000).toISOString());
    expect(args).toEqual({ p_org: "org-1", p_from: from, p_to: to, p_band_edges_milli_c: [...IDLE_BURN_BAND_EDGES_MILLI_C] });
  });

  it("reads PostgREST's bigint strings as numbers", () => {
    expect(idleBurnInputRows([{ vehicle_id: "v1", band: 2, parks: 3, running_sec: "7200", fuel_ml: "5450" }])).toEqual([
      { vehicleId: "v1", band: 2, parks: 3, runningSec: 7200, fuelMl: 5450 },
    ]);
  });
});
