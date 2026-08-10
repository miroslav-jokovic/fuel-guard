import { describe, expect, it } from "vitest";
import { summarizeIdleTelemetry, type IdleTelemetrySeries } from "./idleTelemetry.js";

const emptySeries: IdleTelemetrySeries = {
  batteryMilliVolts: [],
  engineRpm: [],
  engineLoadPercent: [],
  ecuSpeedMph: [],
};

describe("summarizeIdleTelemetry", () => {
  it("returns explicit empty summaries when no samples are available", () => {
    expect(summarizeIdleTelemetry(emptySeries)).toEqual({
      batteryMilliVolts: { samples: 0, min: null, max: null, average: null },
      engineRpm: { samples: 0, min: null, max: null, average: null },
      engineLoadPercent: { samples: 0, min: null, max: null, average: null },
      ecuSpeedMph: { samples: 0, min: null, max: null, average: null },
    });
  });

  it("filters non-finite samples and rounds numeric summaries", () => {
    expect(
      summarizeIdleTelemetry({
        ...emptySeries,
        engineRpm: [
          { t: 1, value: 700.123 },
          { t: Number.NaN, value: 900 },
          { t: 2, value: Number.POSITIVE_INFINITY },
          { t: 3, value: 800.456 },
        ],
      }).engineRpm,
    ).toEqual({ samples: 2, min: 700.12, max: 800.46, average: 750.29 });
  });
});
