import { describe, expect, it } from "vitest";
import { resolveFuelBalance } from "./consumptionContext.js";
import type { VehicleView } from "@fuelguard/shared";

const vehicle: VehicleView = { id: "v1", fuelType: "diesel", tankCapacityGal: 240, baselineMpg: 6.5 };
const row = (id: string, before: number, after: number) => ({
  id,
  created_at: `2026-08-08T12:0${id}Z`,
  fueled_at: `2026-08-08T12:0${id}Z`,
  fueled_at_precision: "instant",
  source: "fuel_card",
  fueling_time_basis: "tank_confirmed",
  samsara_recon_at: `2026-08-08T12:0${id}Z`,
  samsara_location_matched: true,
  samsara_fuel_pct_before: before,
  samsara_fuel_pct_after: after,
});

describe("resolveFuelBalance", () => {
  it("uses tank state to calculate consumed fuel", () => {
    const result = resolveFuelBalance([row("1", 10, 50), row("2", 40, 80)], vehicle, 200, "samsara_obd", 6.5);
    expect(result.mode).toBe("tank_balance");
    expect(result.startTankGallons).toBe(24);
    expect(result.endTankGallons).toBe(192);
    expect(result.consumedGallons).toBe(32);
    expect(result.sampleCount).toBe(2);
  });

  it("falls back when confirmed tank evidence is insufficient", () => {
    const result = resolveFuelBalance([row("1", 10, 50)], vehicle, 100, "entered", 6.5);
    expect(result.mode).toBe("mpg_fallback");
    expect(result.consumedGallons).toBeNull();
  });
});
