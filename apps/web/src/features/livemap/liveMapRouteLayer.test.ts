import { describe, it, expect, vi } from "vitest";
import type { LiveMapRouteFuelStop } from "@silvicom/shared";
import { fuelStopLines, isMarkerClick, lineFeature, pinElement, routeBounds, syncRoute, type RouteMap } from "./liveMapRouteLayer";

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

/**
 * The route that would not close (owner, 2026-10-09). The canvas used to skip the clear whenever
 * `isStyleLoaded()` was false — which it is for the second or two the fitted view's tiles load, right
 * after every draw. `syncRoute` must clear on a map that is still loading tiles.
 */
describe("syncRoute", () => {
  function fakeMap() {
    const sources = new Set<string>(["load-route-covered", "load-route-ahead"]);
    const layers = new Set<string>(["load-route-covered", "load-route-ahead", "selected"]);
    return {
      isStyleLoaded: () => false,
      getSource: (id: string) => (sources.has(id) ? { setData: () => {} } : undefined),
      addSource: (id: string) => void sources.add(id),
      removeSource: (id: string) => void sources.delete(id),
      getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
      addLayer: (l: { id: string }) => void layers.add(l.id),
      removeLayer: (id: string) => void layers.delete(id),
      setPaintProperty: () => {},
      fitBounds: vi.fn(),
      sources,
      layers,
    };
  }

  it("clears a drawn route while the map is still loading tiles", () => {
    const map = fakeMap();
    syncRoute(map as unknown as RouteMap, null, "selected");
    expect([...map.sources]).toEqual([]);
    expect([...map.layers]).toEqual(["selected"]);
  });
});

describe("pinElement", () => {
  it("draws pickup green and delivery red, named by the stop, as a teardrop whose tip is the stop", () => {
    const start = pinElement({ lat: 41, lng: -88, name: "Shipper Co", kind: "pickup" }, "start");
    expect(start.getAttribute("aria-label")).toBe("Pickup: Shipper Co");
    expect(start.title).toBe("Pickup: Shipper Co");
    expect(start.className).toContain("text-success-600");
    expect(start.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 24 34");
    const end = pinElement({ lat: 42, lng: -87, name: null, kind: "dropoff" }, "end");
    expect(end.getAttribute("aria-label")).toBe("Delivery");
    expect(end.className).toContain("text-danger-600");
  });
});

describe("isMarkerClick", () => {
  it("knows a click on a fuel stop or a pin — the marker element or anything inside it — from a click on the map", () => {
    const marker = document.createElement("div");
    marker.className = "maplibregl-marker";
    const pin = pinElement({ lat: 41, lng: -88, name: null, kind: "pickup" }, "start");
    marker.append(pin);
    document.body.append(marker);
    expect(isMarkerClick(marker)).toBe(true);
    expect(isMarkerClick(pin)).toBe(true);
    expect(isMarkerClick(pin.querySelector("path"))).toBe(true);
    expect(isMarkerClick(document.createElement("canvas"))).toBe(false);
    expect(isMarkerClick(null)).toBe(false);
    marker.remove();
  });
});
