import { describe, it, expect } from "vitest";
import { fleetMpgScope } from "./fuelListFilters.js";

/**
 * Which of the Fuel log's filters a truck-measured fleet MPG can answer (M4, D-MPG1/D-MPG3).
 *
 * Each refusal below is a product decision, not a guard: the alternative in every case is showing a
 * number that is correct about something other than what the reader is looking at, which is the
 * disagreement this whole programme exists to end. They are pinned here rather than in the tab
 * because the tile, the export and any later surface must decide them identically.
 */
describe("fleetMpgScope", () => {
  it("answers a bare date range for the whole fleet", () => {
    expect(fleetMpgScope({ from: "2026-09-01", to: "2026-09-07" })).toEqual({
      vehicleIds: undefined,
      unanswerable: null,
    });
  });

  it("carries a truck filter through, because trucks are exactly what it CAN be narrowed to", () => {
    expect(fleetMpgScope({ vehicleIds: ["v1", "v2"] })).toEqual({
      vehicleIds: ["v1", "v2"],
      unanswerable: null,
    });
  });

  it("keeps an EMPTY truck list empty — 'none of these units are ours' is an answer", () => {
    expect(fleetMpgScope({ vehicleIds: [] }).vehicleIds).toEqual([]);
    expect(fleetMpgScope({ vehicleIds: [] }).unanswerable).toBeNull();
  });

  it("refuses a driver filter, and points at where a driver's own figure lives", () => {
    // Scoping to "the trucks this driver touched" would report those trucks' whole distance as the
    // driver's — a bigger lie than no number.
    const s = fleetMpgScope({ driverId: "d1" });
    expect(s.vehicleIds).toBeUndefined();
    expect(s.unanswerable).toMatch(/driver's page/);
  });

  it("refuses a search term, because it selects fills rather than trucks", () => {
    expect(fleetMpgScope({ search: "Pilot" }).unanswerable).toMatch(/locations and cards/);
    // …and a term that sanitises away to nothing is not a filter at all.
    expect(fleetMpgScope({ search: "%%%" }).unanswerable).toBeNull();
  });

  it("refuses a reefer filter, and answers a tractor one — reefer fuel moves no truck (D-MPG5)", () => {
    expect(fleetMpgScope({ tankType: "reefer" }).unanswerable).toMatch(/moves no truck/);
    expect(fleetMpgScope({ tankType: "tractor" }).unanswerable).toBeNull();
  });

  it("does not let a truck filter rescue a filter it cannot answer", () => {
    // The tile would otherwise show those trucks' whole distance under a bar naming one driver.
    expect(fleetMpgScope({ vehicleIds: ["v1"], driverId: "d1" }).vehicleIds).toBeUndefined();
  });
});
