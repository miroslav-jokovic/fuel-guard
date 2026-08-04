import { describe, it, expect } from "vitest";
import { parseVehicleGpsSnapshots, cityFromFormattedLocation } from "./samsara/index.js";

describe("parseVehicleGpsSnapshots", () => {
  it("maps each vehicle's gps fix (location, coords, time) by Samsara id", () => {
    const out = parseVehicleGpsSnapshots({
      data: [
        {
          id: "212014918176378",
          gps: {
            latitude: 37.38229104,
            longitude: -122.05264563,
            time: "2026-08-04T20:04:10Z",
            reverseGeo: { formattedLocation: "Butano Avenue, Sunnyvale, CA" },
          },
        },
        { id: "v2", gps: { latitude: 41.85, longitude: -87.65 } }, // fix without reverseGeo
        { id: "v3" }, // no gps object at all → omitted
        { gps: { latitude: 1, longitude: 2 } }, // no id → omitted
      ],
    });
    expect(out.size).toBe(2);
    expect(out.get("212014918176378")).toEqual({
      location: "Butano Avenue, Sunnyvale, CA",
      lat: 37.38229104,
      lng: -122.05264563,
      time: "2026-08-04T20:04:10Z",
    });
    expect(out.get("v2")).toEqual({ location: null, lat: 41.85, lng: -87.65, time: null });
  });

  it("keeps the reverse-geocoded location even when coordinates are missing", () => {
    const out = parseVehicleGpsSnapshots({
      data: [{ id: "v1", gps: { reverseGeo: { formattedLocation: "Joliet, IL" } } }],
    });
    expect(out.get("v1")).toEqual({ location: "Joliet, IL", lat: null, lng: null, time: null });
  });

  it("returns an empty map for an empty or absent data array", () => {
    expect(parseVehicleGpsSnapshots({}).size).toBe(0);
    expect(parseVehicleGpsSnapshots({ data: [] }).size).toBe(0);
  });
});

describe("cityFromFormattedLocation", () => {
  it("reduces a street-level Samsara address to City, ST", () => {
    expect(cityFromFormattedLocation("Butano Avenue, Sunnyvale, CA")).toBe("Sunnyvale, CA");
  });

  it("keeps an already-short City, ST unchanged", () => {
    expect(cityFromFormattedLocation("Sunnyvale, CA")).toBe("Sunnyvale, CA");
  });

  it("handles a trailing zip / country after the state", () => {
    expect(cityFromFormattedLocation("1 Main St, Joliet, IL 60435, USA")).toBe("Joliet, IL");
  });

  it("falls back to the last two tokens when no US/CA state token exists", () => {
    expect(cityFromFormattedLocation("Carretera 45, Ciudad Juárez, Chihuahua")).toBe(
      "Ciudad Juárez, Chihuahua",
    );
  });

  it("returns null for blank / undefined", () => {
    expect(cityFromFormattedLocation("")).toBeNull();
    expect(cityFromFormattedLocation("   ")).toBeNull();
    expect(cityFromFormattedLocation(null)).toBeNull();
    expect(cityFromFormattedLocation(undefined)).toBeNull();
  });
});
