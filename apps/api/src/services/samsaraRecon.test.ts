import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileWithSamsara } from "./samsaraRecon.js";
import type { Env } from "../env.js";

const env = { SITE_PROX_MILES: 0.5, LOCATION_MISMATCH_MIN_MILES: 50 } as unknown as Env;
const admin = {} as unknown as SupabaseClient; // unused when fetcher + geocode are injected
const noGeocode = async () => null;

// One simulated day: driving in TX, then a fuel stop in Dallas where the tank jumps 20% → 85%.
const rawStats = {
  data: [
    {
      gps: [
        { time: "2026-06-30T13:00:00Z", latitude: 32.4, longitude: -99.7, speedMilesPerHour: 60, reverseGeo: { formattedLocation: "I-20, Abilene, TX, 79601" }, decorations: { obdOdometerMeters: { value: 100000 * 1609.344 } } },
        { time: "2026-06-30T14:00:00Z", latitude: 32.78, longitude: -96.8, speedMilesPerHour: 0, reverseGeo: { formattedLocation: "100 Fuel Rd, Dallas, TX, 75201" }, decorations: { obdOdometerMeters: { value: 100210 * 1609.344 } } },
        { time: "2026-06-30T14:20:00Z", latitude: 32.78, longitude: -96.8, speedMilesPerHour: 0, reverseGeo: { formattedLocation: "100 Fuel Rd, Dallas, TX, 75201" }, decorations: { obdOdometerMeters: { value: 100210 * 1609.344 } } },
        { time: "2026-06-30T16:00:00Z", latitude: 32.9, longitude: -96.7, speedMilesPerHour: 55, reverseGeo: { formattedLocation: "US-75, Dallas, TX, 75201" }, decorations: { obdOdometerMeters: { value: 100230 * 1609.344 } } },
      ],
      fuelPercents: [
        { time: "2026-06-30T13:00:00Z", value: 22 },
        { time: "2026-06-30T14:00:00Z", value: 20 },
        { time: "2026-06-30T14:30:00Z", value: 85 },
        { time: "2026-06-30T16:00:00Z", value: 82 },
      ],
    },
  ],
};

describe("reconcileWithSamsara — tank-rise anchor", () => {
  it("anchors odometer + time on the tank rise even when the report time is hours off", async () => {
    const recon = await reconcileWithSamsara(
      admin,
      env,
      "org1",
      {
        vehicleId: "v1",
        samsaraVehicleId: "sv1",
        fueledAt: "2026-06-30T09:00:00", // an EFS auth time, ~5h before the real fill
        city: "Dallas",
        state: "TX",
        locationName: "Loves Dallas",
        preciseTime: true,
        gallons: 90,
        tankCapacityGal: 120,
      },
      async () => rawStats,
      noGeocode,
    );
    expect(recon).not.toBeNull();
    expect(recon!.fuelingTimeBasis).toBe("tank_confirmed");
    expect(recon!.matchedAt).toBe("2026-06-30T14:00:00Z"); // the tank stop, not 09:00
    expect(recon!.crossSourceOdometer).toBe(100210);
    expect(recon!.observedState).toBe("TX");
    expect(recon!.observedCity).toBe("Dallas");
    expect(recon!.observedLat).toBeCloseTo(32.78, 2);
    expect(recon!.tankPctAfter).toBe(85);
    expect(recon!.locationMatched).toBe(true); // truck was in TX → in_state
    expect(recon!.locationConfidence).toBe("in_state");
  });

  it("falls back to stop_estimated when there is no fuel-level data", async () => {
    const noFuel = { data: [{ gps: rawStats.data[0]!.gps, fuelPercents: [] }] };
    const recon = await reconcileWithSamsara(
      admin,
      env,
      "org1",
      { vehicleId: "v1", samsaraVehicleId: "sv1", fueledAt: "2026-06-30T14:05:00", city: "Dallas", state: "TX", locationName: null, preciseTime: true, gallons: 90, tankCapacityGal: 120 },
      async () => noFuel,
      noGeocode,
    );
    expect(recon!.fuelingTimeBasis).toBe("stop_estimated"); // stop matched, but no tank confirmation
    expect(recon!.crossSourceOdometer).toBe(100210);
  });
});
