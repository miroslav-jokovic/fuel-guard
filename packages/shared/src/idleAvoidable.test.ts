import { describe, it, expect } from "vitest";
import {
  computeAvoidable,
  avoidableCost,
  idleScore,
  type AvoidableInput,
} from "./idleAvoidable.js";

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
  it("Learned-'apu' pattern alone is NOT avoidable — telematics can't confirm an APU (engine-off == shutdown)", () => {
    // A truck that merely sits engine-off through parks looks APU-capable but may just be shutting down. With
    // no admin flag we cannot say it HAD an alternative, so its continuous idle is reported, not blamed.
    const r = computeAvoidable({ ...base, learnedCapability: "apu" });
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.unavoidableIdleSec).toBe(5 * H);
    expect(r.continuousIdleSec).toBe(5 * H);
    expect(r.shortIdleSec).toBe(1 * H); // 6h total idle − 5h in the park session
    expect(r.alternative).toBe("unknown");
    expect(r.hasAlternative).toBe(false);
    expect(r.confident).toBe(false); // unconfirmed equipment → excluded from scoring, not counted as waste
  });

  it("Admin 'no APU' (has_apu=false) OVERRIDES a learned-'apu' pattern → idle is unavoidable, not blamed", () => {
    // The exact false-positive we are fixing: the truck rests engine-off (learned apu) but the admin recorded
    // it has NO APU. The curated record wins; its continuous idle is unavoidable.
    const r = computeAvoidable({ ...base, hasApu: false, learnedCapability: "apu" });
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.unavoidableIdleSec).toBe(5 * H);
    expect(r.alternative).toBe("none");
    expect(r.hasAlternative).toBe(false);
    expect(r.confident).toBe(true); // an explicit "no equipment" record IS judgeable
  });

  it("A curated APU flag makes continuous idle avoidable even before the pattern is learned", () => {
    // has_apu is the maintained source of truth; the truck owns an APU and idled continuously → avoidable.
    const r = computeAvoidable({ ...base, hasApu: true, learnedCapability: "unknown" });
    expect(r.avoidableIdleSec).toBe(5 * H);
    expect(r.alternative).toBe("apu");
    expect(r.hasAlternative).toBe(true);
    expect(r.confident).toBe(true);
  });

  it("A curated Optimized-Idle flag likewise makes continuous main-engine idle avoidable", () => {
    const r = computeAvoidable({ ...base, hasOptimizedIdle: true });
    expect(r.alternative).toBe("optimized_idle");
    expect(r.avoidableIdleSec).toBe(5 * H);
    expect(r.hasAlternative).toBe(true);
  });

  it("counts only complete in-envelope Optimized Idle evidence as avoidable", () => {
    const r = computeAvoidable({
      ...base,
      hasOptimizedIdle: true,
      optimizedEnvelope: {
        status: "sufficient",
        source: "documented_default",
        insideSec: 2 * H,
        outsideSec: 3 * H,
        unknownSec: 0,
        ambiguousSec: 0,
      },
    });
    expect(r.avoidableIdleSec).toBe(2 * H);
    expect(r.justifiedIdleSec).toBe(3 * H);
    expect(r.uncertainIdleSec).toBe(0);
    expect(r.unavoidableIdleSec).toBe(0);
    expect(r.confident).toBe(true);
  });

  it("does not blame Optimized Idle continuous time when temperature evidence is incomplete", () => {
    const r = computeAvoidable({
      ...base,
      hasOptimizedIdle: true,
      optimizedEnvelope: {
        status: "insufficient",
        source: "documented_default",
        insideSec: 0,
        outsideSec: 0,
        unknownSec: 5 * H,
        ambiguousSec: 0,
      },
    });
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.uncertainIdleSec).toBe(5 * H);
    expect(r.confident).toBe(false);
  });

  it("applies only the bounded on-duty grace when HOS overlap is sufficient", () => {
    const r = computeAvoidable({
      ...base,
      hasApu: true,
      dutyEvidence: {
        status: "sufficient",
        workSec: 2 * H,
        unknownSec: 0,
        ambiguousSec: 0,
        graceSec: 15 * 60,
      },
    });
    expect(r.avoidableIdleSec).toBe(5 * H - 15 * 60);
    expect(r.operationalGraceIdleSec).toBe(15 * 60);
    expect(r.confident).toBe(true);
  });

  it("does not score continuous idle when HOS evidence is incomplete or conflicting", () => {
    const r = computeAvoidable({
      ...base,
      hasApu: true,
      dutyEvidence: {
        status: "insufficient",
        workSec: 0,
        unknownSec: 5 * H,
        ambiguousSec: 0,
        graceSec: 0,
      },
    });
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.uncertainIdleSec).toBe(5 * H);
    expect(r.confident).toBe(false);
  });

  it("Demonstrably continuous-only: same idle is UNAVOIDABLE, not blamed", () => {
    const r = computeAvoidable({ ...base, hasApu: null, learnedCapability: "continuous_only" });
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.unavoidableIdleSec).toBe(5 * H);
    expect(r.alternative).toBe("none");
    expect(r.hasAlternative).toBe(false);
    expect(r.confident).toBe(true); // we've established there was no alternative → judgeable
  });

  it("clamps classified idle to observed idle when park sessions drift above the day totals", () => {
    // Day-total idle is only 4h, but sessions (independently synced) sum to 8h continuous → must scale to 4h,
    // so avoidable never exceeds observed idle (the '30h avoidable of a 22h truck' bug).
    const r = computeAvoidable({
      ...base,
      idleSec: 4 * H,
      driveSec: 2 * H,
      coverageSec: 10 * H,
      sessions: [{ idleSec: 8 * H, mode: "continuous" }],
      hasApu: true,
    });
    expect(r.continuousIdleSec).toBe(4 * H); // scaled down from 8h
    expect(r.avoidableIdleSec).toBe(4 * H);
    expect(r.avoidableIdleSec).toBeLessThanOrEqual(r.idleSec);
    expect(r.avoidableIdleSec).toBeLessThanOrEqual(r.engineOnSec);
    expect(r.shortIdleSec).toBe(0);
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
    const r = computeAvoidable({
      ...base,
      sessions: [{ idleSec: 3 * H, mode: "continuous" }],
      learnedCapability: "unknown",
    });
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

  it("Learned optimized-idle pattern alone is NOT avoidable without an admin flag (display/cross-check only)", () => {
    const r = computeAvoidable({ ...base, learnedCapability: "ecu_optimized" });
    expect(r.alternative).toBe("unknown");
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.hasAlternative).toBe(false);
  });
});

describe("avoidableCost", () => {
  it("defaults to 0.8 gal/hr and $4.00/gal", () => {
    expect(avoidableCost(1 * H)).toEqual({ gallons: 0.8, usd: 3.2 });
  });
  it("honors custom burn and price", () => {
    expect(avoidableCost(2 * H, { idleGalPerHour: 1, fuelPricePerGal: 5 })).toEqual({
      gallons: 2,
      usd: 10,
    });
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
