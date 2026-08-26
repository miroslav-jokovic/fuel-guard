import { describe, expect, it } from "vitest";
import { DIESEL_TAX_QUARTERS } from "./rates2026.js";
import { dieselTaxAt, dieselTaxQuarterFor, weightMileReason } from "./taxTable.js";

/**
 * The table is minted by `scripts/fetch-ifta-rates.mjs` and these tests do not re-verify its digits —
 * that is the script's cross-quarter gate's job, and a test that retyped the rates would be the
 * transcription error the generator exists to prevent. What is pinned here is everything a consumer
 * can get wrong ABOUT the table: which quarter a date falls in, that an unknown answer is null and
 * never zero, and that Oregon's missing rate does not read as free fuel.
 */
describe("dieselTaxQuarterFor", () => {
  it("takes the quarter boundary as inclusive on both sides", () => {
    expect(dieselTaxQuarterFor("2026-06-30")?.version).toBe("2Q2026");
    expect(dieselTaxQuarterFor("2026-07-01")?.version).toBe("3Q2026");
  });

  it("does not extrapolate past the captured range — a rate is legislated, not carried forward", () => {
    expect(dieselTaxQuarterFor("2025-12-31")).toBeNull();
    expect(dieselTaxQuarterFor("2026-10-01")).toBeNull();
  });

  it("covers every day of every quarter it claims, with no gap between them", () => {
    const sorted = [...DIESEL_TAX_QUARTERS].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let i = 1; i < sorted.length; i += 1) {
      const previousEnd = new Date(`${sorted[i - 1]!.effectiveTo}T00:00:00Z`);
      previousEnd.setUTCDate(previousEnd.getUTCDate() + 1);
      expect(previousEnd.toISOString().slice(0, 10)).toBe(sorted[i]!.effectiveFrom);
    }
  });
});

describe("dieselTaxAt", () => {
  it("prices a purchase from the quarter in force on its business date", () => {
    // California moved 0.9710 → 0.9790 on 2026-07-01, which is the property a single-rate table
    // cannot express and the reason the dataset is versioned at all.
    expect(dieselTaxAt("CA", "2026-06-30")?.pumpPerGal).toBe(0.971);
    expect(dieselTaxAt("CA", "2026-07-01")?.pumpPerGal).toBe(0.979);
  });

  it("normalises the code, because the state column is free text upstream", () => {
    expect(dieselTaxAt(" tx ", "2026-08-01")?.pumpPerGal).toBe(0.2);
  });

  it("answers null rather than zero for anything it cannot price", () => {
    expect(dieselTaxAt(null, "2026-08-01")).toBeNull();
    expect(dieselTaxAt("TX", null)).toBeNull();
    expect(dieselTaxAt("TX", "2025-08-01")).toBeNull();
    // A Canadian jurisdiction: deliberately absent, because the matrix's U.S. column for one is an
    // exchange-rate conversion that drifts between captures. Unknown, not free.
    expect(dieselTaxAt("ON", "2026-08-01")).toBeNull();
    expect(dieselTaxAt("ZZ", "2026-08-01")).toBeNull();
  });

  it("prices Oregon at zero per gallon but labels the basis, so it cannot read as cheap fuel", () => {
    const or = dieselTaxAt("OR", "2026-08-01");
    expect(or).not.toBeNull();
    expect(or?.pumpPerGal).toBe(0);
    expect(or?.basis).toBe("weight_mile");
    expect(weightMileReason("OR")).toContain("by the mile");
    expect(weightMileReason("TX")).toBeNull();
  });

  it("keeps a return-billed surcharge out of the pump rate", () => {
    // Kentucky bills 0.1050 on the quarterly return over gallons BURNED there, with no credit for
    // tax-paid gallons. A pump figure that included it would overstate what the driver paid.
    const ky = dieselTaxAt("KY", "2026-08-01");
    expect(ky?.pumpPerGal).toBe(0.22);
    expect(ky?.returnSurchargePerGal).toBe(0.105);
    expect(dieselTaxAt("TX", "2026-08-01")?.returnSurchargePerGal).toBe(0);
  });

  it("carries the matrix's own finality flag through to the figure", () => {
    expect(dieselTaxAt("TX", "2026-05-01")?.final).toBe(true);
    // 3Q2026 was captured 2026-08-26, before IFTA finalised it on September 4.
    expect(dieselTaxAt("TX", "2026-08-01")?.final).toBe(false);
  });
});
