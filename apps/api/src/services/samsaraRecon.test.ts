import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileWithSamsara, SamsaraUnavailableError } from "./samsaraRecon.js";
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
    expect(recon!.crossSourceOdometerAt).toBe("2026-06-30T14:00:00Z"); // read AT the tank-rise fill moment
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
    expect(recon!.crossSourceOdometer).toBe(100210); // in-city Dallas stop → trusted fueling-time reading
    expect(recon!.crossSourceOdometerAt).toBe("2026-06-30T14:00:00Z");
  });

  it("throws SamsaraUnavailableError when the Samsara fetch fails — a systemic outage, NOT 'no data' (F1)", async () => {
    const throwingFetcher = () => {
      throw new Error("Samsara API 400"); // e.g. an invalid decoration param
    };
    await expect(
      reconcileWithSamsara(
        admin,
        env,
        "org1",
        { vehicleId: "v1", samsaraVehicleId: "sv1", fueledAt: "2026-06-30T14:05:00", city: "Dallas", state: "TX", locationName: null, preciseTime: true, gallons: 90, tankCapacityGal: 120 },
        throwingFetcher,
        noGeocode,
      ),
    ).rejects.toBeInstanceOf(SamsaraUnavailableError);
  });

  it("returns null (not an error) when the truck genuinely has no telematics data", async () => {
    const recon = await reconcileWithSamsara(
      admin,
      env,
      "org1",
      { vehicleId: "v1", samsaraVehicleId: "sv1", fueledAt: "2026-06-30T14:05:00", city: "Dallas", state: "TX", locationName: null, preciseTime: true, gallons: 90, tankCapacityGal: 120 },
      async () => ({ data: [] }),
      noGeocode,
    );
    expect(recon).toBeNull();
  });

  it("prefetched (per-vehicle) + window slice yields the SAME result as a per-fill fetch (F3)", async () => {
    const fillInput = {
      vehicleId: "v1",
      samsaraVehicleId: "sv1",
      fueledAt: "2026-06-30T09:00:00",
      city: "Dallas",
      state: "TX",
      locationName: "Loves Dallas",
      preciseTime: true,
      gallons: 90,
      tankCapacityGal: 120,
    };
    // Per-fill path: fetcher returns just this fill's data.
    const perFill = await reconcileWithSamsara(admin, env, "org1", fillInput, async () => rawStats, noGeocode);
    // Prefetched path: same data handed in as prefetchedRaw (reconcile slices to the fill window).
    const prefetched = await reconcileWithSamsara(admin, env, "org1", fillInput, undefined, noGeocode, { prefetchedRaw: rawStats });
    expect(prefetched).toEqual(perFill);
    expect(prefetched!.fuelingTimeBasis).toBe("tank_confirmed");
    expect(prefetched!.matchedAt).toBe("2026-06-30T14:00:00Z");
  });

  it("window slice ignores samples OUTSIDE this fill's window (the per-vehicle landmine)", async () => {
    // A wider per-vehicle response with a DECOY fuel rise + Oklahoma stop three days later, far outside the
    // fill's ±18h window. Without slicing, findFuelingEvent/matchFuelingStop would consider it and corrupt the
    // match. With slicing, only the in-window Dallas fill is seen.
    const wide = {
      data: [
        {
          gps: [
            ...rawStats.data[0]!.gps,
            { time: "2026-07-03T14:00:00Z", latitude: 35.46, longitude: -97.5, speedMilesPerHour: 0, reverseGeo: { formattedLocation: "1 Decoy Rd, Oklahoma City, OK, 73102" }, decorations: { obdOdometerMeters: { value: 101000 * 1609.344 } } },
          ],
          fuelPercents: [
            ...rawStats.data[0]!.fuelPercents,
            { time: "2026-07-03T13:30:00Z", value: 15 },
            { time: "2026-07-03T14:30:00Z", value: 95 }, // bigger decoy rise, later day
          ],
        },
      ],
    };
    const recon = await reconcileWithSamsara(
      admin,
      env,
      "org1",
      { vehicleId: "v1", samsaraVehicleId: "sv1", fueledAt: "2026-06-30T09:00:00", city: "Dallas", state: "TX", locationName: "Loves Dallas", preciseTime: true, gallons: 90, tankCapacityGal: 120 },
      undefined,
      noGeocode,
      { prefetchedRaw: wide },
    );
    // Must pick the in-window Dallas fill, NOT the later Oklahoma decoy.
    expect(recon!.matchedAt).toBe("2026-06-30T14:00:00Z");
    expect(recon!.observedState).toBe("TX");
    expect(recon!.observedCity).toBe("Dallas");
    expect(recon!.tankPctAfter).toBe(85);
  });

  it("does NOT trust the odometer when the only stop is in-state but NOT at the station (no tank rise)", () => {
    // The mass-mismatch bug: EFS says the fill is in Waco, TX, but the truck's only stop that day is in
    // Dallas, TX (in-state, wrong city) and there's no tank-rise confirmation. Reading that stop's odometer
    // would be a wrong-time value, so we return null instead — no false mismatch.
    return reconcileWithSamsara(
      admin,
      env,
      "org1",
      { vehicleId: "v1", samsaraVehicleId: "sv1", fueledAt: "2026-06-30T14:05:00", city: "Waco", state: "TX", locationName: null, preciseTime: true, gallons: 90, tankCapacityGal: 120 },
      async () => ({ data: [{ gps: rawStats.data[0]!.gps, fuelPercents: [] }] }), // Dallas stops, no fuel %
      noGeocode,
    ).then((recon) => {
      expect(recon!.locationMatched).toBe(true); // truck WAS in TX
      expect(recon!.locationConfidence).toBe("in_state");
      expect(recon!.crossSourceOdometer).toBeNull(); // but not at the Waco station → no trusted odometer
      expect(recon!.crossSourceOdometerAt).toBeNull();
    });
  });
});
