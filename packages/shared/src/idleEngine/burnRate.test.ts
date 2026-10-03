import { describe, expect, it } from "vitest";
import type { DeclaredEquipment } from "../idleEquipmentDeclared.js";
import {
  IDLE_BURN_BAND_EDGES_MILLI_C,
  IDLE_BURN_LEARN_DAYS,
  IDLE_BURN_MAX_CI95,
  IDLE_BURN_MIN_TRUCKS,
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
 * D-IE5's learner (IE4), on 0419's interior hours with the trucks-and-interval bar (Q-IE14 research,
 * 2026-10-03). Every expected interval below is worked by hand in its comment, so the formula is checked
 * against arithmetic, not against itself.
 */
const GAL = 3785.411784;
const row = (vehicleId: string, band: number | null, hours: number, galPerHour: number): IdleBurnInputRow => ({
  vehicleId, band, hours, fuelMl: hours * galPerHour * GAL,
});
/** `n` trucks `${p}1..n`, ten hours each, at the given rates. */
const fleetOf = (p: string, band: number | null, rates: number[]) => rates.map((r, i) => row(`${p}${i + 1}`, band, 10, r));
const equipmentOf = (id: string): DeclaredEquipment =>
  id.startsWith("b") ? "battery_apu" : id.startsWith("n") ? "no_apu" : id.startsWith("o") ? "other" : "not_entered";

describe("the prior and the bar", () => {
  it("the prior lies inside §1.4's measured September burn (0.705–0.743 gal/h); the bar is five trucks and ±10%", () => {
    expect(IDLE_BURN_PRIOR_GAL_PER_HOUR).toBeGreaterThanOrEqual(0.705);
    expect(IDLE_BURN_PRIOR_GAL_PER_HOUR).toBeLessThanOrEqual(0.743);
    expect([IDLE_BURN_MIN_TRUCKS, IDLE_BURN_MAX_CI95]).toEqual([5, 0.1]);
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
  // no APU, 50–75 °F: five trucks × 10 h at 0.60/0.62/0.64/0.66/0.68 → r = 0.64. Residuals g − r·h are
  // −0.4, −0.2, 0, 0.2, 0.4 gal; Σ² = 0.4; × 5/4 = 0.5; √ = 0.70711; ÷ 50 h = 0.014142; ÷ 0.64 = 0.022097;
  // × 1.96 = 0.0433 → ±4.3%, learned.
  const tight = fleetOf("n", 2, [0.6, 0.62, 0.64, 0.66, 0.68]);
  // battery APU, 50–75 °F: five trucks at 0.40/0.50/0.64/0.80/0.86 → r = 0.64; residuals −2.4, −1.4, 0, 1.6,
  // 2.2; Σ² = 15.12; × 5/4 = 18.9; √ = 4.3474; ÷ 50 = 0.086948; ÷ 0.64 = 0.13586; × 1.96 = 0.2663 → not learned.
  const wide = fleetOf("b", 2, [0.4, 0.5, 0.64, 0.8, 0.86]);

  it("a rate is gallons over hours summed across trucks — not a mean of truck rates", () => {
    const r = learnIdleBurnRates([row("n1", 2, 30, 0.7), row("n2", 2, 20, 0.9)], equipmentOf);
    expect(r.cells[0]).toMatchObject({ measuredGalPerHour: 0.78, runningHours: 50, gallons: 39, trucks: 2 }); // a mean says 0.80
  });

  it("the 95% interval is clustered by truck: tight trucks are learned, scattered ones are not, at equal hours", () => {
    const r = learnIdleBurnRates([...tight, ...wide], equipmentOf);
    const at = (eq: DeclaredEquipment) => r.cells.find((c) => c.equipment === eq && c.band === 2)!;
    expect(at("no_apu")).toMatchObject({ measuredGalPerHour: 0.64, ci95: 0.043, learned: true, galPerHour: 0.64, source: "cell" });
    expect(at("battery_apu")).toMatchObject({ measuredGalPerHour: 0.64, ci95: 0.266, learned: false });
  });

  it("four trucks are not enough, however tight", () => {
    const r = learnIdleBurnRates(tight.slice(0, 4), equipmentOf);
    expect(r.cells[0]).toMatchObject({ trucks: 4, learned: false });
    expect(r.cells[0]!.ci95!).toBeLessThan(IDLE_BURN_MAX_CI95);
  });

  it("an unlearned cell reads its cohort when the cohort passes, else the fleet, else the prior — and says which", () => {
    // no APU 75–90 °F: two trucks only; the no-APU cohort (tight 50–75 + these) passes the bar.
    const hot = [row("n1", 3, 10, 0.7), row("n2", 3, 10, 0.72)];
    const r = learnIdleBurnRates([...tight, ...hot, ...wide], equipmentOf);
    const cohort = r.cohorts.find((c) => c.equipment === "no_apu")!;
    expect(cohort.learned).toBe(true);
    expect(r.cells.find((c) => c.equipment === "no_apu" && c.band === 3)).toMatchObject({ learned: false, source: "cohort", galPerHour: cohort.measuredGalPerHour });
    // battery APU's cohort is the wide five and fails; so does the fleet, which holds them: the prior.
    expect(r.cohorts.find((c) => c.equipment === "battery_apu")!.learned).toBe(false);
    expect(r.fleet.learned).toBe(false);
    expect(r.cells.find((c) => c.equipment === "battery_apu")).toMatchObject({ source: "prior", galPerHour: IDLE_BURN_PRIOR_GAL_PER_HOUR });
    // Two battery-APU trucks in line with the tight five: their cohort fails on trucks, the fleet of seven passes.
    const near = learnIdleBurnRates([...tight, row("b1", 3, 10, 0.62), row("b2", 3, 10, 0.66)], equipmentOf);
    expect(near.fleet).toMatchObject({ trucks: 7, learned: true });
    expect(near.cells.find((c) => c.equipment === "battery_apu")).toMatchObject({ source: "fleet", galPerHour: near.fleet.measuredGalPerHour });
  });

  it("hours with no temperature are a cell that is never learned on its own, but count in the cohort", () => {
    const r = learnIdleBurnRates(fleetOf("n", null, [0.6, 0.62, 0.64, 0.66, 0.68]), equipmentOf);
    expect(r.cells[0]).toMatchObject({ band: null, label: "No temperature", learned: false, source: "cohort", galPerHour: 0.64 });
    expect(r.cohorts[0]).toMatchObject({ equipment: "no_apu", learned: true, runningHours: 50 });
  });

  it("orders cells by equipment, then band, with no temperature last", () => {
    const r = learnIdleBurnRates([row("u1", 2, 1, 0.6), row("n1", null, 1, 0.6), row("n1", 3, 1, 0.6), row("n1", 2, 1, 0.6), row("b1", 2, 1, 0.6)], equipmentOf);
    expect(r.cells.map((c) => `${c.equipment}:${c.band}`)).toEqual(["battery_apu:2", "no_apu:2", "no_apu:3", "no_apu:null", "not_entered:2"]);
  });

  it("no rows: no cells, and a fleet measure with no rate rather than zero", () => {
    const none = learnIdleBurnRates([], equipmentOf);
    expect(none.cells).toEqual([]);
    expect(none.fleet).toEqual({ trucks: 0, runningHours: 0, gallons: 0, measuredGalPerHour: null, ci95: null, learned: false });
  });
});

describe("idleBurnRateFor", () => {
  // Seven trucks in line: the no-APU cohort and the fleet pass; battery APU (two trucks) does not.
  const rates = learnIdleBurnRates(
    [...fleetOf("n", 2, [0.6, 0.62, 0.64, 0.66, 0.68]), row("b1", 3, 10, 0.62), row("b2", 3, 10, 0.66)],
    equipmentOf,
  );

  it("prices an hour at its cell's resolved rate, found by the reading's band and the truck's equipment", () => {
    expect(idleBurnRateFor(rates, "no_apu", 15_000)).toBe(0.64);
    // battery APU 75–90 °F has two trucks: its cell resolves to the fleet, which passes.
    expect(idleBurnRateFor(rates, "battery_apu", 25_000)).toBe(rates.fleet.measuredGalPerHour);
  });

  it("an hour with no cell at all takes the same fall-back chain, not the prior outright", () => {
    expect(idleBurnRateFor(rates, "no_apu", 25_000)).toBe(0.64); // no cell; the no-APU cohort passes
    expect(idleBurnRateFor(rates, "other", null)).toBe(rates.fleet.measuredGalPerHour);
    const empty = learnIdleBurnRates([], equipmentOf);
    expect(idleBurnRateFor(empty, "no_apu", 15_000)).toBe(IDLE_BURN_PRIOR_GAL_PER_HOUR);
  });
});

describe("idleBurnInputsArgs / idleBurnInputRows (0419's call, shared by the office API and the console)", () => {
  it("asks for the last IDLE_BURN_LEARN_DAYS before now, the org's rows only, on the shared band edges", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    const { from, to, args } = idleBurnInputsArgs("org-1", now);
    expect(to).toBe("2026-10-03T12:00:00.000Z");
    expect(from).toBe(new Date(now.getTime() - IDLE_BURN_LEARN_DAYS * 86_400_000).toISOString());
    expect(args).toEqual({ p_org: "org-1", p_from: from, p_to: to, p_band_edges_milli_c: [...IDLE_BURN_BAND_EDGES_MILLI_C] });
  });

  it("reads PostgREST's bigint strings as numbers", () => {
    expect(idleBurnInputRows([{ vehicle_id: "v1", band: 2, hours: 3, fuel_ml: "5450" }])).toEqual([
      { vehicleId: "v1", band: 2, hours: 3, fuelMl: 5450 },
    ]);
  });
});
