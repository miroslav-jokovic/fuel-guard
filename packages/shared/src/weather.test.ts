import { describe, it, expect } from "vitest";
import { weatherGridCell, utcDate, pickHourlyTempF } from "./weather.js";

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
