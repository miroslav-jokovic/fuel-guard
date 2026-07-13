import { describe, it, expect } from "vitest";
import {
  computeIdleConfidence,
  computeIdleAgreement,
  type IdleConfidenceEvent,
  type IdleConfidenceVehicle,
} from "./idleConfidence.js";

const ev = (o: Partial<IdleConfidenceEvent>): IdleConfidenceEvent => ({
  classification: "discretionary",
  driverId: "d1",
  fuelGal: 1.2,
  airTempF: 70,
  ...o,
});
const veh = (o: Partial<IdleConfidenceVehicle>): IdleConfidenceVehicle => ({
  hasApu: true,
  apuType: "diesel_apu",
  hasOptimizedIdle: false,
  idleCapability: "apu",
  ...o,
});

describe("computeIdleConfidence", () => {
  it("returns null overall when there is nothing to score", () => {
    const r = computeIdleConfidence({ events: [], vehicles: [] });
    expect(r.overall).toBeNull();
  });

  it("reports 100% across the board when everything is covered", () => {
    const r = computeIdleConfidence({ events: [ev({}), ev({})], vehicles: [veh({}), veh({})] });
    expect(r.overall).toBe(100);
    for (const m of r.metrics) expect(m.pct).toBe(100);
  });

  it("excludes brief events from the scored denominators", () => {
    // 1 scored + 1 brief; the brief one must not count against coverage.
    const r = computeIdleConfidence({
      events: [
        ev({}),
        ev({ classification: "brief", driverId: null, fuelGal: null, airTempF: null }),
      ],
      vehicles: [veh({})],
    });
    const attr = r.metrics.find((m) => m.key === "attribution")!;
    expect(attr.total).toBe(1);
    expect(attr.pct).toBe(100);
  });

  it("computes partial coverage correctly", () => {
    const events = [ev({ driverId: null, fuelGal: null, airTempF: null }), ev({}), ev({}), ev({})]; // 3/4 covered
    const r = computeIdleConfidence({ events, vehicles: [veh({})] });
    const attr = r.metrics.find((m) => m.key === "attribution")!;
    expect(attr.pct).toBe(75);
    expect(attr.covered).toBe(3);
    expect(attr.total).toBe(4);
  });

  it("counts equipment as recorded when ANY of the flags is set", () => {
    const r = computeIdleConfidence({
      events: [ev({})],
      vehicles: [
        veh({ hasApu: null, apuType: null, hasOptimizedIdle: true }), // optimized only → recorded
        veh({ hasApu: false, apuType: "none", hasOptimizedIdle: null }), // explicit none → recorded
        veh({ hasApu: null, apuType: null, hasOptimizedIdle: null }), // nothing → not recorded
      ],
    });
    const eq = r.metrics.find((m) => m.key === "equipment")!;
    expect(eq.covered).toBe(2);
    expect(eq.total).toBe(3);
  });

  it("does not count learned 'unknown' as learned", () => {
    const r = computeIdleConfidence({
      events: [ev({})],
      vehicles: [veh({ idleCapability: "unknown" }), veh({ idleCapability: "apu" })],
    });
    const l = r.metrics.find((m) => m.key === "learned")!;
    expect(l.covered).toBe(1);
    expect(l.total).toBe(2);
  });

  it("renormalizes the overall over categories that have data (no events → event metrics excluded)", () => {
    // No events at all, but vehicles fully recorded + learned → overall should be 100 (from vehicle metrics only).
    const r = computeIdleConfidence({ events: [], vehicles: [veh({})] });
    expect(r.overall).toBe(100);
  });
});

describe("computeIdleAgreement", () => {
  it("counts a truck as agreeing when the two idle totals are within band", () => {
    const r = computeIdleAgreement([
      { statesSec: 36000, eventsSec: 30000 }, // ratio 0.83 -> agree
      { statesSec: 36000, eventsSec: 5000 }, // ratio 0.14 -> disagree
    ]);
    expect(r.comparable).toBe(2);
    expect(r.agreeing).toBe(1);
  });
  it("ignores trucks without enough idle on both sides", () => {
    const r = computeIdleAgreement([
      { statesSec: 100, eventsSec: 100 }, // below 1h -> not comparable
      { statesSec: null, eventsSec: 36000 }, // no states -> not comparable
    ]);
    expect(r.comparable).toBe(0);
  });
});

describe("computeIdleConfidence with agreement", () => {
  it("adds the agreement metric only when comparable > 0", () => {
    const base = { events: [ev({})], vehicles: [veh({})] };
    expect(computeIdleConfidence(base).metrics.find((m) => m.key === "agreement")).toBeUndefined();
    const withAgree = computeIdleConfidence({ ...base, agreement: { agreeing: 3, comparable: 4 } });
    expect(withAgree.metrics.find((m) => m.key === "agreement")?.pct).toBe(75);
  });
});
