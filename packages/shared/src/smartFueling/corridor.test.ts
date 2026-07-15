import { describe, it, expect } from "vitest";
import { stationsAlongRoute } from "./corridor.js";

const route = [ { lat: 40, lng: -100 }, { lat: 40, lng: -98 } ]; // west→east
const stations = [
  { id: "on-near", lat: 40.01, lng: -99.5 },   // ~0.7 mi off, mid-route
  { id: "far-off", lat: 41.0, lng: -99.5 },    // ~69 mi off route
  { id: "behind", lat: 40.0, lng: -99.95 },    // near start (behind a mid-route truck)
  { id: "ahead", lat: 40.0, lng: -98.2 },      // near end
];

describe("stationsAlongRoute", () => {
  it("keeps in-corridor stations, drops far-off ones, orders by progress", () => {
    const out = stationsAlongRoute(route, stations, null, { corridorMiles: 2.5 });
    const ids = out.map((c) => c.station.id);
    expect(ids).toContain("on-near");
    expect(ids).toContain("ahead");
    expect(ids).not.toContain("far-off");
    // ordered west→east by along-track
    expect(out.map((c) => c.alongTrackMiles)).toEqual([...out.map((c) => c.alongTrackMiles)].sort((a, b) => a - b));
  });
  it("drops stations behind the truck's current position", () => {
    const truckMid = { lat: 40, lng: -99 };
    const ids = stationsAlongRoute(route, stations, truckMid, { corridorMiles: 2.5 }).map((c) => c.station.id);
    expect(ids).not.toContain("behind");
    expect(ids).toContain("ahead");
  });
});
