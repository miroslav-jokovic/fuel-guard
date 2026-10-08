import { describe, it, expect } from "vitest";
import { beforeDetectionEpoch, caseIsAfterReset, detectionEpochOrFilter } from "./detectionEpoch.js";
import { ANOMALY_DISPOSITIONS, DISPOSITION_LABELS, RETIRED_DISPOSITION } from "./constants.js";
import { anomalyTransitionSchema } from "./anomaly.js";

const EPOCH = "2026-10-08T12:00:00+00:00";

describe("the fill-detection start date (D-CF9, chunk 7b)", () => {
  it("a fill before the start date is before it; at or after it is not", () => {
    expect(beforeDetectionEpoch("2026-10-08T11:59:59Z", EPOCH)).toBe(true);
    expect(beforeDetectionEpoch("2026-10-08T12:00:00Z", EPOCH)).toBe(false);
    expect(beforeDetectionEpoch("2026-10-08T13:00:00Z", EPOCH)).toBe(false);
  });

  it("compares instants, not strings: the same moment written in Chicago time is not before", () => {
    expect(beforeDetectionEpoch("2026-10-08T07:00:00-05:00", EPOCH)).toBe(false);
    expect(beforeDetectionEpoch("2026-10-08T06:59:00-05:00", EPOCH)).toBe(true);
  });

  it("no start date (the org was never reset) or no fill time: nothing is before it", () => {
    expect(beforeDetectionEpoch("2020-01-01T00:00:00Z", null)).toBe(false);
    expect(beforeDetectionEpoch("2020-01-01T00:00:00Z", undefined)).toBe(false);
    expect(beforeDetectionEpoch(null, EPOCH)).toBe(false);
  });

  it("a case before the start date is hidden, unless a person is investigating it", () => {
    expect(caseIsAfterReset({ fueled_at: "2026-09-30T18:00:00Z", status: "dismissed" }, EPOCH)).toBe(false);
    expect(caseIsAfterReset({ fueled_at: "2026-09-30T18:00:00Z", status: "open" }, EPOCH)).toBe(false);
    expect(caseIsAfterReset({ fueled_at: "2026-09-30T18:00:00Z", status: "investigating" }, EPOCH)).toBe(true);
    expect(caseIsAfterReset({ fueled_at: "2026-10-08T13:00:00Z", status: "open" }, EPOCH)).toBe(true);
    expect(caseIsAfterReset({ fueled_at: "2026-09-30T18:00:00Z", status: "open" }, null)).toBe(true);
  });

  it("the browser filter says the same in PostgREST, in UTC, and is absent with no start date", () => {
    expect(detectionEpochOrFilter(EPOCH)).toBe("fueled_at.gte.2026-10-08T12:00:00.000Z,status.eq.investigating");
    expect(detectionEpochOrFilter("2026-10-08T07:00:00-05:00")).toBe("fueled_at.gte.2026-10-08T12:00:00.000Z,status.eq.investigating");
    expect(detectionEpochOrFilter(null)).toBeNull();
  });
});

describe("the reset's disposition (0439, Q-CF1)", () => {
  it("has a label, because a stored case can carry it", () => {
    expect(DISPOSITION_LABELS[RETIRED_DISPOSITION]).toBe("Closed at the reset");
  });

  it("is never offered to a reviewer and is refused when closing a case", () => {
    expect((ANOMALY_DISPOSITIONS as readonly string[]).includes(RETIRED_DISPOSITION)).toBe(false);
    const r = anomalyTransitionSchema.safeParse({ status: "dismissed", note: "x", disposition: RETIRED_DISPOSITION, version: 1 });
    expect(r.success).toBe(false);
  });
});
