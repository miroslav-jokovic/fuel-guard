import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { syncFuelPriceDays } from "./fuelPriceDaySync.js";

const ORG = "org-1";
/** `organizations` is read by primary key to resolve the day-boundary timezone — no org_id to scope by. */
const ORG_LOOKUP = ["organizations"];
const END = "2026-08-04T12:00:00.000Z";

function priceRows(rec: ReturnType<typeof createSupabaseRecorder>): Record<string, unknown>[] {
  return rec.writtenRows("fuel_price_days");
}

describe("syncFuelPriceDays", () => {
  it("materializes what the fleet actually paid, gallon-weighted, per day", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        organizations: [{ id: ORG, operating_hours: { tz: "UTC" } }],
        fuel_transactions: [
          // Day 3: a big cheap fill and a small dear one — the day must cost what the gallons cost.
          { fueled_at: "2026-08-03T10:00:00.000Z", price_per_gal: 4.2, gallons: 1000 },
          { fueled_at: "2026-08-03T18:00:00.000Z", price_per_gal: 4.8, gallons: 100 },
          { fueled_at: "2026-08-04T09:00:00.000Z", price_per_gal: 5.0, gallons: 200 },
        ],
        fuel_prices: [],
        idle_settings: { data: { fuel_price_per_gal: 4.5 } },
        fuel_price_days: [],
      },
    });

    const res = await syncFuelPriceDays(rec.client, ORG, { sinceDays: 2, endIso: END });

    const rows = priceRows(rec);
    expect(rows).toHaveLength(3); // 2026-08-02 .. 2026-08-04 inclusive
    const day3 = rows.find((r) => r.day === "2026-08-03")!;
    expect(day3.price_source).toBe("actual");
    expect(Number(day3.effective_price_per_gal)).toBeCloseTo(4.2545, 3);
    expect(Number(day3.actual_gallons)).toBe(1100);
    expect(day3.actual_fill_count).toBe(2);

    const day4 = rows.find((r) => r.day === "2026-08-04")!;
    expect(Number(day4.effective_price_per_gal)).toBe(5);
    expect(res.bySource.actual).toBe(2);
    expect(res.fills).toBe(3);
    expectOrgScoped(rec, ORG, { exempt: ORG_LOOKUP });
  });

  it("carries the last actual price across a day with no purchases and records the origin", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        organizations: [{ id: ORG, operating_hours: { tz: "UTC" } }],
        fuel_transactions: [
          { fueled_at: "2026-08-02T10:00:00.000Z", price_per_gal: 4.4, gallons: 500 },
        ],
        fuel_prices: [],
        idle_settings: { data: null },
        fuel_price_days: [],
      },
    });

    await syncFuelPriceDays(rec.client, ORG, { sinceDays: 2, endIso: END });

    const rows = priceRows(rec);
    const carried = rows.find((r) => r.day === "2026-08-04")!;
    expect(carried.price_source).toBe("carried_forward");
    expect(Number(carried.effective_price_per_gal)).toBe(4.4);
    expect(carried.carried_from_day).toBe("2026-08-02"); // staleness stays auditable
    expect(carried.actual_price_per_gal).toBeNull(); // never claims a purchase that did not happen
  });

  it("buckets fills on the org's clock, not UTC, so a price day lines up with its idle day", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        organizations: [{ id: ORG, operating_hours: { tz: "America/Chicago" } }],
        // 02:00 UTC on the 4th is still the 3rd in Chicago — the day idle_rollup_days would file it under.
        fuel_transactions: [
          { fueled_at: "2026-08-04T02:00:00.000Z", price_per_gal: 4.9, gallons: 300 },
        ],
        fuel_prices: [],
        idle_settings: { data: null },
        fuel_price_days: [],
      },
    });

    await syncFuelPriceDays(rec.client, ORG, { sinceDays: 2, endIso: END });

    const rows = priceRows(rec);
    expect(rows.find((r) => r.day === "2026-08-03")!.price_source).toBe("actual");
    expect(rows.find((r) => r.day === "2026-08-04")!.price_source).toBe("carried_forward");
  });

  it("every emitted day carries a usable price — the cost model can never find a gap", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        organizations: [{ id: ORG, operating_hours: { tz: "UTC" } }],
        fuel_transactions: [],
        fuel_prices: [],
        idle_settings: { data: null },
        fuel_price_days: [],
      },
    });

    const res = await syncFuelPriceDays(rec.client, ORG, { sinceDays: 5, endIso: END });
    const rows = priceRows(rec);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => Number(r.effective_price_per_gal) > 0)).toBe(true);
    expect(res.bySource.default).toBe(6);
  });

  it("rejects an out-of-range window rather than silently clamping it", async () => {
    const rec = createSupabaseRecorder({ tables: {} });
    await expect(syncFuelPriceDays(rec.client, ORG, { sinceDays: 0 })).rejects.toThrow(RangeError);
    await expect(syncFuelPriceDays(rec.client, ORG, { sinceDays: 5000 })).rejects.toThrow(RangeError);
  });
});
