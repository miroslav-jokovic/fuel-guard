import { describe, it, expect } from "vitest";
import type { LiveMapRouteFuelStop } from "@silvicom/shared";
import { fuelStopLines, lineFeature, routeBounds } from "./liveMapRouteLayer";

/** The pure parts of the route layer (TRUCK-CARD-ROUTE-PLAN D-TC3, D-TC4). Drawing itself is maplibre's. */
describe("the route layer's geometry and words", () => {
  it("writes a line as GeoJSON in maplibre's [lng, lat] order", () => {
    expect(lineFeature([{ lat: 41, lng: -88 }, { lat: 42, lng: -87 }]).geometry.coordinates).toEqual([[-88, 41], [-87, 42]]);
  });

  it("bounds the whole route — both halves and every fuel stop", () => {
    const stop = { lat: 43, lng: -85 } as LiveMapRouteFuelStop;
    expect(routeBounds({ covered: [{ lat: 41, lng: -88 }], ahead: [{ lat: 42, lng: -86 }], fuelStops: [stop] })).toEqual([[-88, 41], [-85, 43]]);
    expect(routeBounds({ covered: [], ahead: [], fuelStops: [] })).toBeNull();
  });

  it("names a fuel stop and its address, leaving out what the station file does not have", () => {
    const full: LiveMapRouteFuelStop = {
      name: "Pilot Travel Center", brand: "pilot", address: "100 Interstate Dr", city: "Gary", state: "IN", zip: "46406",
      exit: "17", lat: 41.6, lng: -87.4, milesAhead: 30,
    };
    expect(fuelStopLines(full)).toEqual({ title: "Pilot Travel Center · Exit 17", address: "100 Interstate Dr, Gary, IN 46406" });
    expect(fuelStopLines({ ...full, name: null, exit: null, address: null, city: null, zip: null, state: null })).toEqual({ title: "pilot", address: null });
  });
});
