import { describe, expect, it } from "vitest";
import {
  IDLE_COST_BASIS_DEFAULTS,
  IDLE_PRICE_LOOKBACK_DAYS,
  medianOf,
  pickIdleCostBasis,
} from "./idleCostBasis.js";

/**
 * Q9's rule, tested where it is pure. The I/O around it — which tables, which org — is proved in
 * `apps/api/src/modules/idle/idleCostBasis.test.ts`; nothing here touches a database.
 */
describe("medianOf", () => {
  it("takes the middle of an odd sample and the mean of the two middles of an even one", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
  });

  // The reason it is a median: the posted board mixes brands and states, and one bad row should not
  // move the price the whole fleet's idle is charged at.
  it("is not dragged by an outlier the way a mean would be", () => {
    expect(medianOf([5.8, 5.9, 6.0, 42])).toBe(5.95);
  });

  it("drops zero, negative and non-finite rows rather than counting them as prices", () => {
    expect(medianOf([0, -2, Number.NaN, 5, 7])).toBe(6);
  });

  it("answers null when there is nothing to take a median of", () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([0, -1])).toBeNull();
  });
});

describe("pickIdleCostBasis", () => {
  it("prefers the truck-stop median, and says so", () => {
    expect(
      pickIdleCostBasis({ settingsGalPerHour: 0.9, settingsPricePerGal: 4, truckStopMedian: 5.8734 }),
    ).toEqual({ idleGalPerHour: 0.9, fuelPricePerGal: 5.873, priceSource: "truck_stops" });
  });

  it("falls back to the configured price when no prices were collected", () => {
    expect(
      pickIdleCostBasis({ settingsGalPerHour: 0.9, settingsPricePerGal: 4.25, truckStopMedian: null }),
    ).toEqual({ idleGalPerHour: 0.9, fuelPricePerGal: 4.25, priceSource: "settings" });
  });

  it("falls back to the documented defaults when the org has configured nothing", () => {
    expect(pickIdleCostBasis({ settingsGalPerHour: null, settingsPricePerGal: null, truckStopMedian: null })).toEqual({
      ...IDLE_COST_BASIS_DEFAULTS,
      priceSource: "default",
    });
  });

  // The burn rate and the price fall back INDEPENDENTLY: an org that configured a rate and nothing
  // else keeps its rate while the price comes off the board.
  it("keeps a configured burn rate while the price comes from the truck stops", () => {
    expect(
      pickIdleCostBasis({ settingsGalPerHour: 1.1, settingsPricePerGal: null, truckStopMedian: 6 }),
    ).toEqual({ idleGalPerHour: 1.1, fuelPricePerGal: 6, priceSource: "truck_stops" });
  });

  /**
   * `idle_settings` is `not null` with defaults and has no positivity check (0044), so a zero can be
   * saved — and a zero burn rate prices a fleet's whole idle at $0, which reads as "no waste".
   */
  it("treats a stored zero as not configured rather than pricing the fleet's idle at nothing", () => {
    const basis = pickIdleCostBasis({ settingsGalPerHour: 0, settingsPricePerGal: 0, truckStopMedian: null });
    expect(basis.idleGalPerHour).toBe(IDLE_COST_BASIS_DEFAULTS.idleGalPerHour);
    expect(basis).toEqual({ ...IDLE_COST_BASIS_DEFAULTS, priceSource: "default" });
  });

  it("looks back two weeks, the window the resolver reads with", () => {
    expect(IDLE_PRICE_LOOKBACK_DAYS).toBe(14);
  });
});
