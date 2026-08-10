import { describe, expect, it } from "vitest";
import {
  learnIdleTemperatureEnvelope,
  resolveIdleEquipmentProfile,
  resolveOptimizedIdleEnvelope,
  summarizeIdleEquipmentEvidence,
} from "./idleEquipmentEvidence.js";

const START = Date.parse("2026-01-01T00:00:00.000Z");
const END = START + 3600_000;

describe("idle equipment evidence", () => {
  it("classifies a fully observed optimized-idle interval inside the documented default", () => {
    const result = summarizeIdleEquipmentEvidence({
      profile: "optimized_idle_documented_default",
      sessionStartMs: START,
      sessionEndMs: END,
      totalIdleSec: 3600,
      intervals: [{ startMs: START, endMs: END, tempF: 55 }],
    });

    expect(result.status).toBe("inside_documented_default");
    expect(result.ambientKnownIdleSec).toBe(3600);
    expect(result.ambientUnknownIdleSec).toBe(0);
    expect(result.ambientAvgF).toBe(55);
    expect(result.envelopeInsideSec).toBe(3600);
  });

  it("reports outside and mixed conditions without converting them into a score", () => {
    const outside = summarizeIdleEquipmentEvidence({
      profile: "optimized_idle_documented_default",
      sessionStartMs: START,
      sessionEndMs: END,
      totalIdleSec: 3600,
      intervals: [{ startMs: START, endMs: END, tempF: 10 }],
    });
    const mixed = summarizeIdleEquipmentEvidence({
      profile: "optimized_idle_documented_default",
      sessionStartMs: START,
      sessionEndMs: END,
      totalIdleSec: 3600,
      intervals: [
        { startMs: START, endMs: START + 1800_000, tempF: 10 },
        { startMs: START + 1800_000, endMs: END, tempF: 55 },
      ],
    });

    expect(outside.status).toBe("outside_documented_default");
    expect(outside.envelopeOutsideSec).toBe(3600);
    expect(mixed.status).toBe("mixed_documented_default");
    expect(mixed.envelopeInsideSec).toBe(1800);
    expect(mixed.envelopeOutsideSec).toBe(1800);
  });

  it("fails closed for missing or conflicting temperature coverage", () => {
    const missing = summarizeIdleEquipmentEvidence({
      profile: "optimized_idle_documented_default",
      sessionStartMs: START,
      sessionEndMs: END,
      totalIdleSec: 3600,
      intervals: [{ startMs: START, endMs: START + 1800_000, tempF: 55 }],
    });
    const conflicting = summarizeIdleEquipmentEvidence({
      profile: "optimized_idle_documented_default",
      sessionStartMs: START,
      sessionEndMs: END,
      totalIdleSec: 3600,
      intervals: [
        { startMs: START, endMs: END, tempF: 55 },
        { startMs: START, endMs: END, tempF: 70 },
      ],
    });

    expect(missing.status).toBe("insufficient");
    expect(missing.ambientUnknownIdleSec).toBe(1800);
    expect(conflicting.status).toBe("ambiguous");
    expect(conflicting.envelopeAmbiguousSec).toBe(3600);
    expect(conflicting.ambientKnownIdleSec).toBe(0);
  });

  it("does not assume a generic temperature envelope for electrical or diesel APUs", () => {
    expect(
      resolveIdleEquipmentProfile({
        hasApu: true,
        apuType: "battery_hvac",
        hasOptimizedIdle: false,
      }),
    ).toBe("battery_hvac_unprofiled");
    expect(
      summarizeIdleEquipmentEvidence({
        profile: "battery_hvac_unprofiled",
        sessionStartMs: START,
        sessionEndMs: END,
        totalIdleSec: 3600,
        intervals: [{ startMs: START, endMs: END, tempF: 5 }],
      }).status,
    ).toBe("unknown");
  });
});

describe("learnIdleTemperatureEnvelope", () => {
  it("learns a stable cycling cluster only when both continuous temperature tails exist", () => {
    const observations = [
      ...[10, 15, 20, 25, 30].map((temperatureF) => ({
        temperatureF,
        mode: "continuous" as const,
        idleSec: 3600,
      })),
      ...[40, 45, 50, 55, 60, 65, 70, 75, 80, 85].map((temperatureF) => ({
        temperatureF,
        mode: "optimized_cycling" as const,
        idleSec: 3600,
      })),
      ...[90, 95, 100, 105, 110].map((temperatureF) => ({
        temperatureF,
        mode: "continuous" as const,
        idleSec: 3600,
      })),
    ];

    const result = learnIdleTemperatureEnvelope(observations);

    expect(result.status).toBe("sufficient");
    expect(result.lowF).toBe(40);
    expect(result.highF).toBe(90);
    expect(resolveOptimizedIdleEnvelope(result)).toEqual({
      lowF: 40,
      highF: 90,
      source: "learned_behavioral",
    });
  });

  it("keeps the default when seasonal evidence is one-sided", () => {
    const observations = [
      ...[10, 15, 20, 25, 30].map((temperatureF) => ({
        temperatureF,
        mode: "continuous" as const,
        idleSec: 3600,
      })),
      ...[40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110].map((temperatureF) => ({
        temperatureF,
        mode: "optimized_cycling" as const,
        idleSec: 3600,
      })),
    ];

    const result = learnIdleTemperatureEnvelope(observations);

    expect(result.status).toBe("insufficient");
    expect(resolveOptimizedIdleEnvelope(result)).toEqual({
      lowF: 25,
      highF: 90,
      source: "documented_default",
    });
  });

  it("does not infer an envelope for an APU profile", () => {
    expect(
      resolveIdleEquipmentProfile({
        hasApu: true,
        apuType: "battery_hvac",
        hasOptimizedIdle: false,
      }),
    ).toBe("battery_hvac_unprofiled");
  });
});
