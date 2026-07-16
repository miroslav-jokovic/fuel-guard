import { describe, it, expect } from "vitest";
import { resolveEffectivePrice } from "./effectivePrice.js";
import type { DiscountRule } from "./types.js";

const HOUR = 3_600_000;
const now = Date.UTC(2026, 6, 16, 12);
const flat40: DiscountRule = { brand: "pilot", type: "flat", centsOff: 40 };
const base = { brandMedian: null, nowMs: now, ttlHours: 30 };

describe("resolveEffectivePrice", () => {
  it("1) a FRESH tenant net quote wins over everything", () => {
    const r = resolveEffectivePrice({
      ...base,
      tenantSamples: [{ net: 3.899, observedAtMs: now - 2 * HOUR }],
      posted: { price: 4.599, currency: "USD", unit: "gal", observedAtMs: now - 1 * HOUR },
      discountRule: flat40,
    });
    expect(r).toMatchObject({ net: 3.899, basis: "fresh", estimated: false, confidence: "high" });
  });

  it("2) fresh posted − discount rule beats stale tenant history", () => {
    const r = resolveEffectivePrice({
      ...base,
      tenantSamples: [{ net: 3.5, observedAtMs: now - 5 * 24 * HOUR }], // stale (past TTL, in lookback)
      posted: { price: 4.599, currency: "USD", unit: "gal", observedAtMs: now - 3 * HOUR },
      discountRule: flat40,
    });
    expect(r).toMatchObject({ net: 4.199, basis: "posted_discount", estimated: true, confidence: "medium" });
  });

  it("2b) posted with no rule is used as-is (posted retail is a real price)", () => {
    const r = resolveEffectivePrice({ ...base, tenantSamples: [], posted: { price: 4.599, currency: "USD", unit: "gal", observedAtMs: now }, discountRule: null });
    expect(r).toMatchObject({ net: 4.599, basis: "posted_discount" });
  });

  it("CURRENCY SAFETY: CAD/L posted is rejected, falls through to history/brand/none", () => {
    const r = resolveEffectivePrice({
      ...base,
      tenantSamples: [],
      posted: { price: 1.999, currency: "CAD", unit: "L", observedAtMs: now },
      discountRule: flat40,
    });
    expect(r).toMatchObject({ net: null, basis: "none" });
  });

  it("stale posted is not used (falls to tenant history)", () => {
    const r = resolveEffectivePrice({
      ...base,
      tenantSamples: [
        { net: 4.0, observedAtMs: now - 4 * 24 * HOUR },
        { net: 4.1, observedAtMs: now - 5 * 24 * HOUR },
        { net: 4.2, observedAtMs: now - 6 * 24 * HOUR },
      ],
      posted: { price: 4.599, currency: "USD", unit: "gal", observedAtMs: now - 40 * HOUR }, // past 30h TTL
      discountRule: flat40,
    });
    expect(r).toMatchObject({ net: 4.1, basis: "station_history", confidence: "medium" });
  });

  it("falls through to brand median, then none", () => {
    expect(resolveEffectivePrice({ ...base, tenantSamples: [], posted: null, discountRule: null, brandMedian: 4.35 })).toMatchObject({ net: 4.35, basis: "brand", confidence: "low" });
    expect(resolveEffectivePrice({ ...base, tenantSamples: [], posted: null, discountRule: null })).toMatchObject({ net: null, basis: "none" });
  });

  it("a nonsensical rule that drives net ≤ 0 is rejected (falls through, never a free-fuel plan)", () => {
    const r = resolveEffectivePrice({
      ...base,
      tenantSamples: [],
      posted: { price: 0.35, currency: "USD", unit: "gal", observedAtMs: now },
      discountRule: flat40,
    });
    expect(r).toMatchObject({ net: null, basis: "none" });
  });
});
