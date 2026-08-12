import { describe, expect, it } from "vitest";
import { computeAvoidable, avoidableCost } from "./idleAvoidable.js";
import { sumRollupByVehicle, type VehicleRollupSums } from "./idleBreakdown.js";
import { idlePrecisionFixtures } from "./idlePrecisionFixtures.js";

const hours = (sec: number) => Math.round(sec / 360) / 10;

function envelopeFor(s: VehicleRollupSums, hasOptimizedIdle: boolean | null) {
  if (hasOptimizedIdle !== true || s.continuous <= 0) return undefined;
  return {
    status: s.optimizedEnvelopeStatus === "not_applicable" ? "unavailable" : s.optimizedEnvelopeStatus,
    source: s.optimizedEnvelopeSource,
    insideSec: s.optimizedEnvelopeInside,
    outsideSec: s.optimizedEnvelopeOutside,
    unknownSec: s.optimizedEnvelopeUnknown,
    ambiguousSec: s.optimizedEnvelopeAmbiguous,
  } as const;
}

function dutyFor(s: VehicleRollupSums) {
  if (s.continuous <= 0) return undefined;
  return {
    status: s.hosEvidenceStatus === "not_applicable" ? "unavailable" : s.hosEvidenceStatus,
    workSec: s.hosWork,
    unknownSec: s.hosUnknown,
    ambiguousSec: s.hosAmbiguous,
    graceSec: s.hosGrace,
  } as const;
}

describe("verified live idle precision fixtures", () => {
  for (const fixture of idlePrecisionFixtures) {
    it(`${fixture.kind} — unit ${fixture.unit}`, () => {
      const sums = sumRollupByVehicle(fixture.rows);
      const s = sums.get(fixture.vehicleId);
      expect(s).toBeDefined();
      const result = computeAvoidable({
        driveSec: s!.drive,
        idleSec: s!.idle,
        offSec: s!.off,
        coverageSec: s!.cov,
        periodSec: fixture.periodSec,
        sessions: [
          { idleSec: s!.continuous, mode: "continuous" },
          { idleSec: s!.managed, mode: "apu_or_off" },
        ],
        hasApu: fixture.hasApu,
        hasOptimizedIdle: fixture.hasOptimizedIdle,
        learnedCapability: fixture.learnedCapability,
        optimizedEnvelope: envelopeFor(s!, fixture.hasOptimizedIdle),
        dutyEvidence: dutyFor(s!),
      });
      const cost = avoidableCost(result.avoidableIdleSec, fixture.costBasis);

      expect({
        alternative: result.alternative,
        confident: result.confident,
        avoidableSec: result.avoidableIdleSec,
        unavoidableSec: result.unavoidableIdleSec,
        justifiedSec: result.justifiedIdleSec,
        uncertainSec: result.uncertainIdleSec,
        graceSec: result.operationalGraceIdleSec,
        managedSec: result.managedIdleSec,
      }).toEqual({
        alternative: fixture.expected.alternative,
        confident: fixture.expected.confident,
        avoidableSec: fixture.expected.avoidableSec,
        unavoidableSec: fixture.expected.unavoidableSec,
        justifiedSec: fixture.expected.justifiedSec,
        uncertainSec: fixture.expected.uncertainSec,
        graceSec: fixture.expected.graceSec,
        managedSec: fixture.expected.managedSec,
      });
      expect({
        avoidableH: hours(result.avoidableIdleSec),
        unavoidableH: hours(result.unavoidableIdleSec),
        uncertainH: hours(result.uncertainIdleSec),
        managedH: hours(result.managedIdleSec),
        avoidableUsd: cost.usd,
      }).toEqual({
        avoidableH: fixture.expected.avoidableH,
        unavoidableH: fixture.expected.unavoidableH,
        uncertainH: fixture.expected.uncertainH,
        managedH: fixture.expected.managedH,
        avoidableUsd: fixture.expected.avoidableUsd,
      });
    });
  }
});
