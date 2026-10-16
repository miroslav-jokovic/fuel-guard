import { describe, expect, it } from "vitest";
import { DRIVEN_PATH_MAX_HOURS, drivenPathWindow, thinPath } from "./drivenPath.js";

const NOW = new Date("2026-10-16T16:00:00.000Z");

describe("drivenPathWindow — from the pickup's departure, at most three days", () => {
  it("starts at the departure when it is inside the cap", () => {
    expect(drivenPathWindow("2026-10-15T18:59:00Z", NOW)).toEqual({ startIso: "2026-10-15T18:59:00.000Z", capped: false });
  });

  it("starts at the cap, and says so, for a load that left longer ago", () => {
    expect(DRIVEN_PATH_MAX_HOURS).toBe(72);
    expect(drivenPathWindow("2026-09-28T10:00:00Z", NOW)).toEqual({ startIso: "2026-10-13T16:00:00.000Z", capped: true });
  });

  it("has no window before the truck has left, or for a departure it cannot read", () => {
    expect(drivenPathWindow(null, NOW)).toBeNull();
    expect(drivenPathWindow("2026-10-16T17:00:00Z", NOW)).toBeNull();
    expect(drivenPathWindow("not a date", NOW)).toBeNull();
  });
});

describe("thinPath — Douglas–Peucker on the route geometry's own measure", () => {
  // ~0.07 mi apart along one meridian: a straight road.
  const straight = Array.from({ length: 50 }, (_, i) => ({ lat: 41 + i * 0.001, lng: -88 }));

  it("draws a straight road with its two ends", () => {
    expect(thinPath(straight)).toEqual([straight[0], straight[49]]);
  });

  it("keeps a corner, and the points either side of it that make it a corner", () => {
    // North 49 points, then a right-angle turn east for 49: the corner at index 49 must survive.
    const east = Array.from({ length: 49 }, (_, i) => ({ lat: 41.049, lng: -88 + (i + 1) * 0.001 }));
    const out = thinPath([...straight, ...east]);
    expect(out).toEqual([straight[0], straight[49], east[48]]);
  });

  it("keeps every corner of a road that turns twice, on both sides of the first split", () => {
    // A short jog east, a long run north, then a long run east. The jog's corner is near the start and
    // close to the line from end to end, so it is not the first split; it survives only if the half
    // BEFORE that split is thinned too. Driven the other way, it is the half after. Both are asserted.
    const leg = (from: { lat: number; lng: number }, to: { lat: number; lng: number }, n: number) =>
      Array.from({ length: n }, (_, i) => ({ lat: from.lat + ((to.lat - from.lat) * (i + 1)) / n, lng: from.lng + ((to.lng - from.lng) * (i + 1)) / n }));
    const a = { lat: 41, lng: -88 }, b = { lat: 41, lng: -87.99 }, c = { lat: 41.1, lng: -87.99 }, d = { lat: 41.1, lng: -87.8 };
    const road = [a, ...leg(a, b, 10), ...leg(b, c, 50), ...leg(c, d, 50)];
    const corners = thinPath(road).map((p) => [p.lat.toFixed(3), p.lng.toFixed(3)]);
    expect(corners).toEqual([["41.000", "-88.000"], ["41.000", "-87.990"], ["41.100", "-87.990"], ["41.100", "-87.800"]]);
    expect(thinPath([...road].reverse()).map((p) => [p.lat.toFixed(3), p.lng.toFixed(3)])).toEqual([...corners].reverse());
  });

  it("drops a wobble inside the tolerance and keeps one outside it", () => {
    // 0.0001° of longitude here is ~0.005 mi; 0.001° is ~0.05 mi.
    const wobble = (dLng: number) => straight.map((p, i) => (i === 25 ? { ...p, lng: p.lng + dLng } : p));
    expect(thinPath(wobble(0.0001))).toHaveLength(2);
    expect(thinPath(wobble(0.001))).toContainEqual({ lat: straight[25]!.lat, lng: -88 + 0.001 });
  });

  it("returns two points or fewer as they are", () => {
    expect(thinPath([])).toEqual([]);
    expect(thinPath([straight[0]!, straight[1]!])).toEqual([straight[0], straight[1]]);
  });

  it("thins a full 72-hour trail — 43,200 fixes with GPS noise and a night parked — to a drawable line", () => {
    // Samsara's ~6 s cadence for the whole window: a gentle curve with ±~15 m of noise, then ten hours
    // parked, the fix wandering by the same noise around one spot. Noise is deterministic, so this is too.
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.0003;
    const trail = Array.from({ length: 43_200 }, (_, i) => {
      const parked = i >= 20_000 && i < 26_000;
      const t = parked ? 20_000 : i;
      return { lat: 38 + t * 0.00012 + noise(), lng: -95 + Math.sin(t / 4000) * 2 + noise() };
    });
    const out = thinPath(trail);
    expect(out[0]).toEqual(trail[0]);
    expect(out.at(-1)).toEqual(trail.at(-1));
    expect(out.length).toBeLessThan(trail.length / 10);
  });
});
