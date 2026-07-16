import { describe, it, expect } from "vitest";
import { estimateStationPrice, median, type PriceSample } from "./priceHistory.js";

const H = 3_600_000;
const NOW = 1_000_000_000_000;
const at = (hoursAgo: number, net: number | null): PriceSample => ({ net, observedAtMs: NOW - hoursAgo * H });

describe("median", () => {
  it("returns null for empty, the middle for odd, and the average for even", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("estimateStationPrice", () => {
  const opts = { ttlHours: 30, lookbackHours: 21 * 24 };

  it("uses a fresh quote as-is (not estimated, high confidence)", () => {
    const e = estimateStationPrice([at(2, 3.499), at(200, 3.2)], NOW, opts);
    expect(e).toMatchObject({ net: 3.499, estimated: false, confidence: "high", basis: "fresh" });
  });

  it("falls back to the median of recent history when the freshest quote is stale", () => {
    // Nothing within 30h, but three quotes within the lookback → median, estimated, medium confidence.
    const e = estimateStationPrice([at(40, 3.6), at(60, 3.4), at(80, 3.5)], NOW, opts);
    expect(e.estimated).toBe(true);
    expect(e.basis).toBe("station_history");
    expect(e.confidence).toBe("medium");
    expect(e.net).toBe(3.5); // median of 3.4/3.5/3.6
  });

  it("marks a thin history (<3 samples) as low confidence", () => {
    const e = estimateStationPrice([at(40, 3.6), at(60, 3.4)], NOW, opts);
    expect(e).toMatchObject({ estimated: true, confidence: "low", basis: "station_history", net: 3.5 });
  });

  it("ignores quotes older than the lookback window", () => {
    // Only sample is 30 days old (> 21-day lookback) → no station history usable → brand fallback.
    const e = estimateStationPrice([at(30 * 24, 3.9)], NOW, { ...opts, brandMedian: 3.75 });
    expect(e).toMatchObject({ estimated: true, confidence: "low", basis: "brand", net: 3.75 });
  });

  it("uses the brand median when the station has no usable history", () => {
    const e = estimateStationPrice([], NOW, { ...opts, brandMedian: 3.71 });
    expect(e).toMatchObject({ estimated: true, confidence: "low", basis: "brand", net: 3.71 });
  });

  it("returns null (no-price) when there is nothing to go on", () => {
    const e = estimateStationPrice([at(500, null)], NOW, opts);
    expect(e).toMatchObject({ net: null, estimated: false, basis: "none" });
  });

  it("prefers a fresh quote over both history and a brand median", () => {
    const e = estimateStationPrice([at(1, 3.30), at(50, 3.9)], NOW, { ...opts, brandMedian: 3.71 });
    expect(e).toMatchObject({ net: 3.30, estimated: false, basis: "fresh" });
  });
});
