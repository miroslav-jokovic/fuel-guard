/** Pure summaries for the numeric Samsara telemetry used as parked-idle evidence. */

export interface IdleTelemetrySample {
  t: number;
  value: number;
}

export interface IdleTelemetryMetricSummary {
  samples: number;
  min: number | null;
  max: number | null;
  average: number | null;
}

export interface IdleTelemetrySeries {
  batteryMilliVolts: IdleTelemetrySample[];
  engineRpm: IdleTelemetrySample[];
  engineLoadPercent: IdleTelemetrySample[];
  ecuSpeedMph: IdleTelemetrySample[];
}

export interface IdleTelemetrySummary {
  batteryMilliVolts: IdleTelemetryMetricSummary;
  engineRpm: IdleTelemetryMetricSummary;
  engineLoadPercent: IdleTelemetryMetricSummary;
  ecuSpeedMph: IdleTelemetryMetricSummary;
}

function summarize(samples: IdleTelemetrySample[]): IdleTelemetryMetricSummary {
  const valid = samples.filter((sample) => Number.isFinite(sample.t) && Number.isFinite(sample.value));
  if (valid.length === 0) return { samples: 0, min: null, max: null, average: null };
  let total = 0;
  let min = valid[0]!.value;
  let max = valid[0]!.value;
  for (const sample of valid) {
    total += sample.value;
    min = Math.min(min, sample.value);
    max = Math.max(max, sample.value);
  }
  return {
    samples: valid.length,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    average: Math.round((total / valid.length) * 100) / 100,
  };
}

export function summarizeIdleTelemetry(series: IdleTelemetrySeries): IdleTelemetrySummary {
  return {
    batteryMilliVolts: summarize(series.batteryMilliVolts),
    engineRpm: summarize(series.engineRpm),
    engineLoadPercent: summarize(series.engineLoadPercent),
    ecuSpeedMph: summarize(series.ecuSpeedMph),
  };
}
