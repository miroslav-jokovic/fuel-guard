import { describe, it, expect } from "vitest";
import {
  computeAvoidable,
  avoidableCost,
  idleScore,
  ON_DUTY_GRACE_SEC,
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

  it("judges the temperature-evidenced share and excludes only the unevidenced seconds", () => {
    // 5h continuous idle; the temperature overlay reaches 4.7h of it (2h inside the band, 2.7h outside) and
    // 0.3h has no reading. The old binary rule zeroed EVERY Optimized-Idle truck over gaps this small
    // (production: 93.1% ambient coverage fleet-wide, but only 49% of sessions gap-free, so all 33 trucks
    // with sessions carried at least one gap). Now the gap is uncertain and the rest is judged.
    const r = computeAvoidable({
      ...base,
      hasOptimizedIdle: true,
      optimizedEnvelope: {
        status: "insufficient", // the aggregate STATUS no longer decides — the seconds do
        source: "documented_default",
        insideSec: 2 * H,
        outsideSec: 2.7 * H,
        unknownSec: 0.3 * H,
        ambiguousSec: 0,
      },
    });
    expect(r.avoidableIdleSec).toBe(2 * H);
    expect(r.justifiedIdleSec).toBe(2.7 * H);
    expect(r.uncertainIdleSec).toBe(0.3 * H);
    expect(r.unavoidableIdleSec).toBe(0);
    expect(r.confident).toBe(true); // 94% evidenced >= 80% floor
  });

  it("stays unconfident when less than 80% of continuous idle carries temperature evidence", () => {
    const r = computeAvoidable({
      ...base,
      hasOptimizedIdle: true,
      optimizedEnvelope: {
        status: "insufficient",
        source: "documented_default",
        insideSec: 2 * H,
        outsideSec: H,
        unknownSec: 2 * H, // 40% unevidenced
        ambiguousSec: 0,
      },
    });
    expect(r.avoidableIdleSec).toBe(2 * H); // still judged conservatively, never inflated
    expect(r.justifiedIdleSec).toBe(H);
    expect(r.uncertainIdleSec).toBe(2 * H);
    expect(r.confident).toBe(false);
  });

  it("treats conflicting (ambiguous) temperature seconds as uncertain, same as unevidenced ones", () => {
    const r = computeAvoidable({
      ...base,
      hasOptimizedIdle: true,
      optimizedEnvelope: {
        status: "ambiguous",
        source: "documented_default",
        insideSec: 4.75 * H,
        outsideSec: 0,
        unknownSec: 0,
        ambiguousSec: 0.25 * H, // 5% conflicted — judged share 95%, confident
      },
    });
    expect(r.avoidableIdleSec).toBe(4.75 * H);
    expect(r.uncertainIdleSec).toBe(0.25 * H);
    expect(r.confident).toBe(true);
  });

  it("excludes continuous idle the temperature overlay never reached at all", () => {
    // Envelope present but empty (no overlapping readings): nothing is proven either way, so every second
    // is uncertain — never silently unavoidable, and never confident.
    const r = computeAvoidable({
      ...base,
      hasOptimizedIdle: true,
      optimizedEnvelope: {
        status: "unavailable",
        source: "none",
        insideSec: 0,
        outsideSec: 0,
        unknownSec: 0,
        ambiguousSec: 0,
      },
    });
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.uncertainIdleSec).toBe(5 * H);
    expect(r.unavoidableIdleSec).toBe(0);
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

  it("judges the evidenced share and excludes only the unevidenced seconds (seconds-weighted duty)", () => {
    // 5h continuous idle; duty overlay covers 4.5h, 0.5h has no usable HOS interval. The old binary rule
    // zeroed the whole truck for this (the 30-of-31-clean-days production collapse); now the 0.5h is
    // uncertain, the 4.5h is judged, and the truck is confident (90% evidenced >= 80% floor).
    const r = computeAvoidable({
      ...base,
      hasApu: true,
      dutyEvidence: {
        status: "insufficient", // the aggregate STATUS no longer decides — the seconds do
        workSec: H,
        unknownSec: 0.5 * H,
        ambiguousSec: 0,
        graceSec: 0,
      },
    });
    expect(r.uncertainIdleSec).toBe(0.5 * H);
    expect(r.avoidableIdleSec).toBe(4.5 * H);
    expect(r.unavoidableIdleSec).toBe(0);
    expect(r.confident).toBe(true);
  });

  it("stays unconfident when less than 80% of continuous idle carries duty evidence", () => {
    const r = computeAvoidable({
      ...base,
      hasApu: true,
      dutyEvidence: {
        status: "insufficient",
        workSec: 0,
        unknownSec: 2 * H, // 40% unevidenced
        ambiguousSec: 0,
        graceSec: 0,
      },
    });
    expect(r.uncertainIdleSec).toBe(2 * H);
    expect(r.avoidableIdleSec).toBe(3 * H); // still judged conservatively, never inflated
    expect(r.confident).toBe(false);
  });

  it("treats conflicting (ambiguous) duty seconds as uncertain, same as unevidenced ones", () => {
    const r = computeAvoidable({
      ...base,
      hasApu: true,
      dutyEvidence: {
        status: "ambiguous",
        workSec: 0,
        unknownSec: 0,
        ambiguousSec: 0.25 * H, // 5% conflicted — judged share 95%, confident
        graceSec: 0,
      },
    });
    expect(r.uncertainIdleSec).toBe(0.25 * H);
    expect(r.avoidableIdleSec).toBe(4.75 * H);
    expect(r.confident).toBe(true);
  });

  it("applies grace to the evidenced portion under partial duty evidence", () => {
    const r = computeAvoidable({
      ...base,
      hasApu: true,
      dutyEvidence: {
        status: "insufficient",
        workSec: H,
        unknownSec: 0.5 * H,
        ambiguousSec: 0,
        graceSec: 30 * 60,
      },
    });
    expect(r.operationalGraceIdleSec).toBe(30 * 60);
    expect(r.uncertainIdleSec).toBe(0.5 * H);
    expect(r.avoidableIdleSec).toBe(4.5 * H - 30 * 60);
    expect(r.confident).toBe(true);
  });

  it("credits one grace allowance PER on-duty park, not one per period", () => {
    // graceSec arrives already bounded per park by buildSessionDutyEvidence (ON_DUTY_GRACE_SEC each), so a
    // range covering several on-duty parks carries several allowances. Re-capping the SUM at one allowance
    // gave every truck 15 minutes of grace for an entire month — every row of the 31-day precision report
    // read exactly 900s (audit 2026-08-13).
    const parks = 6;
    const r = computeAvoidable({
      ...base,
      hasApu: true,
      dutyEvidence: {
        status: "sufficient",
        workSec: 2 * H,
        unknownSec: 0,
        ambiguousSec: 0,
        graceSec: parks * ON_DUTY_GRACE_SEC,
      },
    });
    expect(r.operationalGraceIdleSec).toBe(parks * ON_DUTY_GRACE_SEC);
    expect(r.avoidableIdleSec).toBe(5 * H - parks * ON_DUTY_GRACE_SEC);
  });

  it("never lets grace exceed the continuous idle it is carved out of", () => {
    const r = computeAvoidable({
      ...base,
      hasApu: true,
      dutyEvidence: {
        status: "sufficient",
        workSec: 5 * H,
        unknownSec: 0,
        ambiguousSec: 0,
        graceSec: 40 * H, // absurd producer value
      },
    });
    expect(r.operationalGraceIdleSec).toBe(5 * H);
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.unavoidableIdleSec).toBe(0);
  });

  it("Learned continuous-only does NOT deny an alternative — only an admin record can", () => {
    // The mirror of the learned-'apu' rule above, and it matters more. A truck whose driver never uses its
    // APU is indistinguishable from a truck that has none, so treating "continuous_only" as proof of no
    // equipment auto-excused the heaviest idlers and dropped them out of the equipment queue (25 trucks,
    // 6,785 h). Behaviour cannot establish absence; it lands as unconfirmed, same as any other pattern.
    const r = computeAvoidable({ ...base, hasApu: null, learnedCapability: "continuous_only" });
    expect(r.avoidableIdleSec).toBe(0); // still never blamed
    expect(r.alternative).toBe("unknown"); // needs equipment, not "settled: none"
    expect(r.hasAlternative).toBe(false);
    expect(r.confident).toBe(false);
  });

  it("An admin 'no equipment' record still settles it as unavoidable", () => {
    const r = computeAvoidable({ ...base, hasApu: false, learnedCapability: "continuous_only" });
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.unavoidableIdleSec).toBe(5 * H);
    expect(r.alternative).toBe("none");
    expect(r.confident).toBe(true);
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

describe("reducibleIdleSec — the opportunity measure", () => {
  const rest = (restSec: number, extra: Partial<AvoidableInput["dutyEvidence"]> = {}) => ({
    status: "sufficient" as const,
    restSec,
    workSec: 0,
    unknownSec: 0,
    ambiguousSec: 0,
    graceSec: 0,
    ...extra,
  });

  it("reports rest idle an alternative could carry on a truck with NO equipment recorded", () => {
    // The case the page could not express: unconfirmed truck, avoidable is a correct zero (nothing to
    // use), but 4h of rest idle is exactly what fitting an APU would save. That is the capex number.
    const r = computeAvoidable({ ...base, hasApu: null, dutyEvidence: rest(4 * H) });
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.alternative).toBe("unknown");
    expect(r.reducibleIdleSec).toBe(4 * H);
  });

  it("reports it on a truck the admin recorded as having no equipment", () => {
    const r = computeAvoidable({ ...base, hasApu: false, dutyEvidence: rest(4 * H) });
    expect(r.avoidableIdleSec).toBe(0);
    expect(r.unavoidableIdleSec).toBe(5 * H); // correctly not blamed
    expect(r.reducibleIdleSec).toBe(4 * H); // ...but fitting equipment would still save this
  });

  it("converges with avoidable on an equipped truck", () => {
    const r = computeAvoidable({ ...base, hasApu: true, dutyEvidence: rest(5 * H) });
    expect(r.avoidableIdleSec).toBe(5 * H);
    expect(r.reducibleIdleSec).toBe(5 * H);
  });

  it("excludes the operational grace and the duty-unevidenced seconds", () => {
    const r = computeAvoidable({
      ...base,
      hasApu: null,
      dutyEvidence: rest(4 * H, { unknownSec: 0.5 * H, graceSec: 30 * 60, workSec: H }),
    });
    // 4h rest, capped at the 4.5h of duty-evidenced continuous idle, less the 30-min grace.
    expect(r.reducibleIdleSec).toBe(4 * H - 30 * 60);
  });

  it("never exceeds the continuous idle it is drawn from", () => {
    const r = computeAvoidable({ ...base, hasApu: null, dutyEvidence: rest(40 * H) });
    expect(r.reducibleIdleSec).toBe(5 * H);
  });

  it("subtracts weather-justified seconds — no APU would have held those either", () => {
    const r = computeAvoidable({
      ...base,
      hasOptimizedIdle: true,
      optimizedEnvelope: {
        status: "sufficient",
        source: "documented_default",
        insideSec: 3 * H,
        outsideSec: 2 * H,
        unknownSec: 0,
        ambiguousSec: 0,
      },
      dutyEvidence: rest(5 * H),
    });
    expect(r.justifiedIdleSec).toBe(2 * H);
    expect(r.reducibleIdleSec).toBe(3 * H);
  });

  it("is null — never a fabricated zero — when there is no duty overlay at all", () => {
    expect(computeAvoidable({ ...base, hasApu: true }).reducibleIdleSec).toBeNull();
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

describe("bucket algebra (precision harness invariant, 2026-08-12)", () => {
  const H = 3600;
  const algebraBase: AvoidableInput = {
    driveSec: 8 * H,
    idleSec: 6 * H,
    offSec: 4 * H,
    coverageSec: 18 * H,
    periodSec: 24 * H,
    sessions: [{ idleSec: 5 * H, mode: "continuous" }],
    hasApu: null,
    hasOptimizedIdle: null,
    learnedCapability: "unknown",
  };
  const bucketSum = (r: ReturnType<typeof computeAvoidable>) =>
    r.avoidableIdleSec +
    r.unavoidableIdleSec +
    r.justifiedIdleSec +
    r.uncertainIdleSec +
    r.operationalGraceIdleSec;

  it("never lets grace push the bucket sum past continuous when the envelope made everything uncertain", () => {
    // Optimized-idle truck, temperature evidence insufficient (all continuous -> uncertain) AND a duty
    // overlay carrying a 15-min grace. Grace must yield: the sum stayed 900s over before the fix.
    const r = computeAvoidable({
      ...algebraBase,
      hasOptimizedIdle: true,
      optimizedEnvelope: {
        status: "insufficient",
        source: "documented_default",
        insideSec: 0,
        outsideSec: 0,
        unknownSec: 5 * H,
        ambiguousSec: 0,
      },
      dutyEvidence: {
        status: "sufficient",
        workSec: H,
        unknownSec: 0,
        ambiguousSec: 0,
        graceSec: 15 * 60,
      },
    });
    expect(r.operationalGraceIdleSec).toBe(0);
    expect(r.uncertainIdleSec).toBe(5 * H);
    expect(bucketSum(r)).toBe(r.continuousIdleSec);
  });

  it("bucket sum equals continuous across mixed partial-evidence inputs", () => {
    for (const dutyUnknown of [0, 0.5 * H, 2 * H, 5 * H]) {
      for (const grace of [0, 15 * 60, 30 * 60]) {
        const r = computeAvoidable({
          ...algebraBase,
          hasApu: true,
          dutyEvidence: {
            status: "insufficient",
            workSec: H,
            unknownSec: dutyUnknown,
            ambiguousSec: 0,
            graceSec: grace,
          },
        });
        expect(bucketSum(r)).toBe(r.continuousIdleSec);
      }
    }
  });

  it("bucket sum equals continuous when a partial envelope and a partial duty overlay both apply", () => {
    // The combination invariant 3 caught on 2026-08-13 (unit 698): once the envelope contributes REAL
    // justified seconds instead of an all-or-nothing uncertain block, duty uncertainty stacked on top could
    // push justified + uncertain past continuous — 380,280s of buckets against 337,711s of continuous idle.
    for (const inside of [0, H, 2.5 * H, 5 * H]) {
      for (const outside of [0, H, 2.5 * H]) {
        for (const dutyUnknown of [0, 0.5 * H, 3 * H, 5 * H]) {
          for (const grace of [0, 15 * 60, 90 * 60]) {
            const r = computeAvoidable({
              ...algebraBase,
              hasOptimizedIdle: true,
              optimizedEnvelope: {
                status: "insufficient",
                source: "documented_default",
                insideSec: inside,
                outsideSec: outside,
                unknownSec: Math.max(0, 5 * H - inside - outside),
                ambiguousSec: 0,
              },
              dutyEvidence: {
                status: "insufficient",
                workSec: H,
                unknownSec: dutyUnknown,
                ambiguousSec: 0,
                graceSec: grace,
              },
            });
            expect(bucketSum(r)).toBe(r.continuousIdleSec);
            for (const bucket of [
              r.avoidableIdleSec,
              r.unavoidableIdleSec,
              r.justifiedIdleSec,
              r.uncertainIdleSec,
              r.operationalGraceIdleSec,
            ])
              expect(bucket).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});
