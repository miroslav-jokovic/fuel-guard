import { describe, it, expect } from "vitest";
import { computeAvoidable, avoidableCost, idleScore, type AvoidableInput } from "./idleAvoidable.js";

const H = 3600;
const base: AvoidableInput = {
  driveSec: 8 * H,
  idleSec: 6 * H,
  offSec: 4 * H,
  coverageSec: 18 * H, // 8+6+4
  periodSec: 24 * H,
  sessions: [{ idleSec: 5 * H, mode: "continuous" }], // 5h continuous; 1h idle outside any park
  hasApu: null,
  hasOptimizedIdle: null,
  learnedCapability: "unknown",
};

describe("computeAvoidable", () => {
  it("APU truck: continuous idle is avoidable; short idle and managed idle are not", () => {
    const r = computeAvoidable({ ...base, hasApu: true });
    expect(r.avoidableIdleSec).toBe(5 * H);
    expect(r.unavoidableIdleSec).toBe(0);
    expect(r.continuousIdleSec).toBe(5 * H);
    expect(r.managedIdleSec).toBe(0);
    expect(r.shortIdleSec).toBe(1 * H); // 6h total idle − 5h in the park session
    expect(r.engineOnSec).toBe(14 * H);
    expect(r.alternative).toBe("apu");
    expect(r.hasAlternative).toBe(true);
    expect(r.confident).toBe(true);
  });

  it("No-APU, demonstrably continuous-only: same idle is UNAVOIDABLE, not blamed", () => {
    const r = computeAvoidable({ ...base, hasApu: null, learnedCapability: "continuous_only" });
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.unavoidableIdleSec).toBe(5 * H);
    expect(r.alternative).toBe("none");
    expect(r.hasAlternative).toBe(false);
    expect(r.confident).toBe(true); // we've established there was no alternative → judgeable
  });

  it("Managed idle (apu_or_off + optimized_cycling) is never avoidable, even on an APU truck", () => {
    const r = computeAvoidable({
      ...base,
      idleSec: 6 * H,
      sessions: [
        { idleSec: 5 * H, mode: "apu_or_off" },
        { idleSec: 1 * H, mode: "optimized_cycling" },
      ],
      hasApu: true,
    });
    expect(r.managedIdleSec).toBe(6 * H);
    expect(r.continuousIdleSec).toBe(0);
    expect(r.avoidableIdleSec).toBe(0);
  });

  it("Unknown capability + no admin flag → not confident (excluded from scoring), nothing blamed", () => {
    const r = computeAvoidable({ ...base, sessions: [{ idleSec: 3 * H, mode: "continuous" }], learnedCapability: "unknown" });
    expect(r.alternative).toBe("unknown");
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.unavoidableIdleSec).toBe(3 * H);
    expect(r.confident).toBe(false);
  });

  it("Thin coverage → not confident even when the alternative is known", () => {
    const r = computeAvoidable({ ...base, coverageSec: 4 * H, periodSec: 24 * H, hasApu: true }); // 0.167 coverage
    expect(r.coverage).toBeCloseTo(0.167, 2);
    expect(r.confident).toBe(false);
  });

  it("Admin Optimized-Idle flag makes continuous main-engine idle avoidable", () => {
    const r = computeAvoidable({ ...base, hasApu: null, hasOptimizedIdle: true });
    expect(r.alternative).toBe("optimized_idle");
    expect(r.avoidableIdleSec).toBe(5 * H);
  });
});

describe("avoidableCost", () => {
  it("defaults to 0.8 gal/hr and $4.00/gal", () => {
    expect(avoidableCost(1 * H)).toEqual({ gallons: 0.8, usd: 3.2 });
  });
  it("honors custom burn and price", () => {
    expect(avoidableCost(2 * H, { idleGalPerHour: 1, fuelPricePerGal: 5 })).toEqual({ gallons: 2, usd: 10 });
  });
});

describe("idleScore", () => {
  it("is null with no engine-on time (no basis to score)", () => {
    expect(idleScore(0, 0)).toBeNull();
  });
  it("rewards a real denominator: 5h avoidable of 100h run beats 5h of 10h", () => {
    expect(idleScore(5 * H, 100 * H)).toBe(95);
    expect(idleScore(5 * H, 10 * H)).toBe(50);
  });
  it("clamps to 0..100", () => {
    expect(idleScore(0, 50 * H)).toBe(100);
    expect(idleScore(80 * H, 50 * H)).toBe(0);
  });
});
