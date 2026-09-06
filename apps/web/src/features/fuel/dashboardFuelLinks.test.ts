import { describe, it, expect } from "vitest";
import { fuelTileDestinations, FUEL_TILE_LABELS, type FuelTileLabel } from "./dashboardFuelLinks";

/**
 * WHY THIS SUITE EXISTS. All five Dashboard fuel tiles linked to a bare `/fuel-log` — the strip asked
 * five questions and sent every one to the same answer, and dropped the period doing it. Clicking a
 * figure measured over the last 30 days landed on a page showing its own default window, so the
 * number the visitor arrived at was not the number they clicked. That is the assertion this file is
 * really about; the destinations are the cheaper half.
 */

const RANGE = { from: "2026-08-01", to: "2026-08-31" };
const q = (label: FuelTileLabel) =>
  fuelTileDestinations(RANGE)[label] as { path: string; query: Record<string, string> };

describe("the Dashboard's fuel tile links", () => {
  // The defect. A tile that cannot be clicked through to the figure behind it is decoration; one that
  // lands on a DIFFERENT figure is worse than decoration.
  it("carries the dashboard's window to every tile, so the destination shows the same period", () => {
    for (const label of FUEL_TILE_LABELS) {
      expect(q(label).query).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    }
  });

  // Each tile points at the page that computes the SAME NUMBER, not merely the page about that topic.
  // Fill-ups and Miles come from the Fuel Log's own range totals, which the Dashboard reuses "so the
  // two pages agree"; Gallons and Spend are what Spend & trend reports.
  it("sends the counts the Fuel Log computes to the Fuel Log, on its Fills tab", () => {
    for (const label of ["Fill-ups", "Miles driven"] as const) {
      expect(q(label).path).toBe("/fuel-log");
      expect(q(label).query.tab).toBe("fills");
    }
  });

  it("sends the money and volume to the spend report, on its Spend & trend tab", () => {
    for (const label of ["Gallons", "Fuel spend"] as const) {
      expect(q(label).path).toBe("/fuel-spend");
      expect(q(label).query.tab).toBe("spend");
    }
  });

  // The honest exception, asserted so it stays deliberate: no page reproduces the fleet AVERAGE —
  // `useFleetMpgSeries` renders on the Dashboard and the IFTA ledger only — so MPG goes to the Fills
  // tab, where the per-fill `computed_mpg` behind it lives.
  it("sends Avg MPG to the fills that carry the per-fill MPG behind it", () => {
    expect(q("Avg MPG").path).toBe("/fuel-log");
    expect(q("Avg MPG").query.tab).toBe("fills");
  });

  // ⚠ /odometer is a mismatch report about readings DISAGREEING, and it holds its range in local refs
  // rather than the URL — so a window sent there is ignored and the visitor lands on another period.
  it("sends nothing to /odometer, which answers a different question and ignores the window", () => {
    for (const label of FUEL_TILE_LABELS) expect(q(label).path).not.toBe("/odometer");
  });

  it("covers every tile in the strip", () => {
    expect(Object.keys(fuelTileDestinations(RANGE)).sort()).toEqual([...FUEL_TILE_LABELS].sort());
  });
});
