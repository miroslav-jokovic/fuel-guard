import { describe, it, expect } from "vitest";
import {
  buildFuelPriceDays,
  calendarDays,
  fuelPriceByDay,
  DEFAULT_FUEL_PRICE_PER_GAL,
} from "./fuelPriceDays.js";

const fill = (day: string, pricePerGal: number, gallons = 100) => ({ day, pricePerGal, gallons });

describe("calendarDays", () => {
  it("is inclusive of both ends", () => {
    expect(calendarDays("2026-07-01", "2026-07-03")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });
  it("returns nothing for an inverted or unparseable range", () => {
    expect(calendarDays("2026-07-03", "2026-07-01")).toEqual([]);
    expect(calendarDays("nope", "2026-07-01")).toEqual([]);
  });
});

describe("buildFuelPriceDays", () => {
  it("prices a day at what the fleet actually paid, gallon-weighted", () => {
    // A plain mean of the two prices is 4.50; the fleet bought ten times as much at 4.20, so the day cost
    // it 4.2273/gal. Weighting by volume is the difference between an average quote and an average cost.
    const [row] = buildFuelPriceDays({
      fromDay: "2026-07-01",
      toDay: "2026-07-01",
      fills: [fill("2026-07-01", 4.2, 1000), fill("2026-07-01", 4.8, 100)],
    });
    expect(row!.priceSource).toBe("actual");
    expect(row!.effectivePricePerGal).toBeCloseTo(4.2545, 3);
    expect(row!.actualGallons).toBe(1100);
    expect(row!.actualFillCount).toBe(2);
  });

  it("counts a priced fill whose quantity is missing rather than dropping the evidence", () => {
    const [row] = buildFuelPriceDays({
      fromDay: "2026-07-01",
      toDay: "2026-07-01",
      fills: [{ day: "2026-07-01", pricePerGal: 4.5, gallons: 0 }],
    });
    expect(row!.priceSource).toBe("actual");
    expect(row!.effectivePricePerGal).toBe(4.5);
    expect(row!.actualFillCount).toBe(1);
  });

  it("carries the last actual price forward across a day with no purchases, and says so", () => {
    const rows = buildFuelPriceDays({
      fromDay: "2026-07-01",
      toDay: "2026-07-03",
      fills: [fill("2026-07-01", 4.2), fill("2026-07-03", 4.6)],
    });
    expect(rows.map((r) => r.priceSource)).toEqual(["actual", "carried_forward", "actual"]);
    expect(rows[1]!.effectivePricePerGal).toBe(4.2);
    expect(rows[1]!.carriedFromDay).toBe("2026-07-01"); // staleness stays auditable
    expect(rows[1]!.actualPricePerGal).toBeNull(); // no purchase happened; don't claim one did
  });

  it("stops carrying a price forward once it is too stale to stand for today", () => {
    const rows = buildFuelPriceDays(
      { fromDay: "2026-07-01", toDay: "2026-07-06", fills: [fill("2026-07-01", 4.2)] },
      { maxCarryForwardDays: 2, settingsPricePerGal: 5 },
    );
    expect(rows.map((r) => r.priceSource)).toEqual([
      "actual",
      "carried_forward",
      "carried_forward",
      "settings",
      "settings",
      "settings",
    ]);
  });

  it("uses a posted market quote when the fleet bought nothing, without letting it become the fleet's price", () => {
    // Posted is a market observation, not this fleet's cost, so the NEXT dataless day must not inherit it.
    const rows = buildFuelPriceDays({
      fromDay: "2026-07-01",
      toDay: "2026-07-03",
      fills: [fill("2026-07-01", 4.2)],
      posted: [{ day: "2026-07-02", pricePerGal: 5.5, sampleCount: 40 }],
    });
    expect(rows[1]!.priceSource).toBe("posted");
    expect(rows[1]!.effectivePricePerGal).toBe(5.5);
    expect(rows[2]!.priceSource).toBe("carried_forward");
    expect(rows[2]!.effectivePricePerGal).toBe(4.2); // carried from the actual, not the posted quote
    expect(rows[2]!.carriedFromDay).toBe("2026-07-01");
  });

  it("seeds the carry chain from a price before the window opens", () => {
    const rows = buildFuelPriceDays({
      fromDay: "2026-07-05",
      toDay: "2026-07-05",
      fills: [],
      priorPrice: { day: "2026-07-04", pricePerGal: 4.44 },
    });
    expect(rows[0]!.priceSource).toBe("carried_forward");
    expect(rows[0]!.effectivePricePerGal).toBe(4.44);
  });

  it("terminates at the configured rate, then the default — a price is never null", () => {
    const [configured] = buildFuelPriceDays(
      { fromDay: "2026-07-01", toDay: "2026-07-01", fills: [] },
      { settingsPricePerGal: 4.75 },
    );
    expect(configured).toMatchObject({ priceSource: "settings", effectivePricePerGal: 4.75 });

    const [fallback] = buildFuelPriceDays({ fromDay: "2026-07-01", toDay: "2026-07-01", fills: [] });
    expect(fallback).toMatchObject({
      priceSource: "default",
      effectivePricePerGal: DEFAULT_FUEL_PRICE_PER_GAL,
    });
  });

  it("ignores non-positive and non-finite prices instead of averaging them in", () => {
    const [row] = buildFuelPriceDays({
      fromDay: "2026-07-01",
      toDay: "2026-07-01",
      fills: [
        fill("2026-07-01", 4.5),
        { day: "2026-07-01", pricePerGal: 0, gallons: 500 },
        { day: "2026-07-01", pricePerGal: Number.NaN, gallons: 500 },
      ],
    });
    expect(row!.effectivePricePerGal).toBe(4.5);
    expect(row!.actualFillCount).toBe(1);
  });

  it("emits one row per day of the window, with no gaps for the cost model to trip on", () => {
    const rows = buildFuelPriceDays({
      fromDay: "2026-07-01",
      toDay: "2026-07-31",
      fills: [fill("2026-07-10", 4.4)],
    });
    expect(rows).toHaveLength(31);
    expect(new Set(rows.map((r) => r.day)).size).toBe(31);
    expect(rows.every((r) => r.effectivePricePerGal > 0)).toBe(true);
  });
});

describe("fuelPriceByDay", () => {
  it("maps each day to its effective price", () => {
    const rows = buildFuelPriceDays({
      fromDay: "2026-07-01",
      toDay: "2026-07-02",
      fills: [fill("2026-07-01", 4.2), fill("2026-07-02", 4.9)],
    });
    expect(fuelPriceByDay(rows).get("2026-07-02")).toBe(4.9);
  });
});
