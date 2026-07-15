import { describe, it, expect } from "vitest";
import { buildTruckRouteUrl, parseHereRoute } from "./hereRoute.js";
import { DEFAULT_ROUTE_FUEL_SETTINGS } from "./types.js";

const profile = DEFAULT_ROUTE_FUEL_SETTINGS.defaultProfile; // 162in, 840in, 102in, 5 axles, 80000 lb

describe("buildTruckRouteUrl", () => {
  const url = buildTruckRouteUrl(
    { origin: { lat: 41.8, lng: -87.6 }, destination: { lat: 39.1, lng: -94.6 }, via: [{ lat: 40.4, lng: -91.0 }], profile, hazmat: ["flammable"], tunnelCategory: "C" },
    "KEY123",
  );
  it("truck mode, endpoints, waypoint, return", () => {
    expect(url).toContain("transportMode=truck");
    expect(url).toContain("origin=41.8%2C-87.6");
    expect(url).toContain("destination=39.1%2C-94.6");
    expect(url).toContain("via=40.4%2C-91");
    expect(url).toContain("return=polyline%2Csummary");
  });
  it("converts US units to HERE kg/cm and passes hazmat/tunnel", () => {
    expect(url).toContain("vehicle%5BgrossWeight%5D=36287"); // 80000 lb -> kg
    expect(url).toContain("vehicle%5Bheight%5D=411"); // 162 in -> cm
    expect(url).toContain("vehicle%5BaxleCount%5D=5");
    expect(url).toContain("vehicle%5BshippedHazardousGoods%5D=flammable");
    expect(url).toContain("vehicle%5BtunnelCategory%5D=C");
    expect(url).toContain("apiKey=KEY123");
  });
});

describe("parseHereRoute", () => {
  it("stitches section polylines + sums summary", () => {
    const r = parseHereRoute({ routes: [{ sections: [
      { polyline: "BFoz5xJ67i1B1B7PzIhaxL7Y", summary: { length: 1200, duration: 90 } },
      { polyline: "BFg9tgKgm5xC", summary: { length: 300, duration: 20 } },
    ] }] });
    expect(r).not.toBeNull();
    expect(r!.distanceMeters).toBe(1500);
    expect(r!.durationSeconds).toBe(110);
    expect(r!.polyline.length).toBe(5); // 4 + 1
  });
  it("null on an empty/blank response", () => {
    expect(parseHereRoute({ routes: [] })).toBeNull();
    expect(parseHereRoute({})).toBeNull();
  });
});
