import { describe, it, expect } from "vitest";
import { weatherGridCell, utcDate, pickHourlyTempF, hourlyThermalIntervals } from "./weather.js";

describe("weatherGridCell", () => {
  it("rounds to a ~0.1 degree grid", () => {
    expect(weatherGridCell(41.8781, -87.6298)).toEqual({ latGrid: 41.9, lngGrid: -87.6 });
  });
});

describe("utcDate", () => {
  it("returns the UTC calendar date", () => {
    expect(utcDate("2026-07-08T23:30:00Z")).toBe("2026-07-08");
  });
});

describe("pickHourlyTempF", () => {
  const day = {
    time: ["2026-07-08T03:00", "2026-07-08T04:00", "2026-07-08T05:00"],
    temperatureF: [60, 64, 68] as (number | null)[],
  };
  it("picks the nearest hour", () => {
    expect(pickHourlyTempF(day, "2026-07-08T04:10:00Z")).toBe(64);
    expect(pickHourlyTempF(day, "2026-07-08T04:40:00Z")).toBe(68);
  });
  it("returns null when the nearest reading is too far from the event", () => {
    expect(pickHourlyTempF(day, "2026-07-09T12:00:00Z")).toBeNull();
  });
  it("returns null for an empty or missing series", () => {
    expect(pickHourlyTempF(null, "2026-07-08T04:00:00Z")).toBeNull();
    expect(pickHourlyTempF({ time: [], temperatureF: [] }, "2026-07-08T04:00:00Z")).toBeNull();
  });
  it("skips a null reading for the matched hour", () => {
    expect(
      pickHourlyTempF({ time: ["2026-07-08T04:00"], temperatureF: [null] }, "2026-07-08T04:05:00Z"),
    ).toBeNull();
  });
});

describe("hourlyThermalIntervals", () => {
  const day = {
    time: ["2026-01-02T00:00", "2026-01-02T01:00", "2026-01-02T02:00", "2026-01-02T03:00"],
    temperatureF: [10, 20, null, 40],
  };
  const byDay = (d: string) => (d === "2026-01-02" ? day : null);
  const at = (h: number, m = 0) => Date.parse(`2026-01-02T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

  it("splits a park on clock hours and gives each its own temperature", () => {
    // A long park is not one temperature: this one starts at 10°F and ends at 40°F, and the envelope has
    // to be able to put those seconds in different buckets.
    expect(hourlyThermalIntervals(at(0), at(4), byDay)).toEqual([
      { startMs: at(0), endMs: at(1), tempF: 10 },
      { startMs: at(1), endMs: at(2), tempF: 20 },
      { startMs: at(2), endMs: at(3), tempF: null },
      { startMs: at(3), endMs: at(4), tempF: 40 },
    ]);
  });

  it("clips partial hours at both ends rather than rounding out to the hour", () => {
    expect(hourlyThermalIntervals(at(0, 20), at(1, 30), byDay)).toEqual([
      { startMs: at(0, 20), endMs: at(1), tempF: 10 },
      { startMs: at(1), endMs: at(1, 30), tempF: 20 },
    ]);
  });

  it("yields null temperatures — never invented ones — when the series has no reading", () => {
    const r = hourlyThermalIntervals(at(0), at(2), () => null);
    expect(r).toHaveLength(2);
    expect(r.every((i) => i.tempF === null)).toBe(true);
  });

  it("returns nothing for an empty or inverted range", () => {
    expect(hourlyThermalIntervals(at(2), at(2), byDay)).toEqual([]);
    expect(hourlyThermalIntervals(at(3), at(1), byDay)).toEqual([]);
    expect(hourlyThermalIntervals(Number.NaN, at(1), byDay)).toEqual([]);
  });
});
