import { describe, it, expect } from "vitest";
import { lastReadingEachDay, type OdometerStatSample } from "./odometerReadings.js";

/**
 * The collection rule, tested for the four ways it can be wrong without looking wrong: the wrong
 * reading of the day (a silent undercount), a zero where there was no data (a hardware event
 * invented), the wrong day boundary (miles moved between periods), and a converted value (policy
 * baked into stored data).
 */
const CHICAGO = "America/Chicago";

const sample = (time: string, meters: number): OdometerStatSample => ({ time, meters });

describe("lastReadingEachDay", () => {
  it("keeps the LAST reading of each day, not the first", () => {
    // The undercount this prevents: `distanceByVehicle` reads the last reading at or before each end
    // of a period. Keeping the morning value would answer a week's closing odometer with the last
    // day's opening one — six days of driving reported as seven days' worth.
    const days = lastReadingEachDay(
      [
        sample("2026-07-06T13:02:00Z", 100_000),
        sample("2026-07-06T23:58:12Z", 412_850),
        sample("2026-07-06T18:40:00Z", 300_000),
      ],
      CHICAGO,
    );
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ readingAt: "2026-07-06T23:58:12Z", meters: 412_850 });
  });

  it("writes NO ROW for a day with no sample — never a zero", () => {
    // 10.8% of vehicle-days are no_data at 2026-01. A zero-metre row would not read as "the truck
    // did not report"; it would read as a counter that reset, which is the one thing the distance
    // rule treats as a hardware event rather than a distance.
    const days = lastReadingEachDay(
      [sample("2026-07-06T20:00:00Z", 500), sample("2026-07-08T20:00:00Z", 900)],
      CHICAGO,
    );
    expect(days.map((d) => d.day)).toEqual(["2026-07-06", "2026-07-08"]);
  });

  it("cuts the day on the fleet's clock, not UTC", () => {
    // 04:30Z on the 7th is 23:30 on the 6th in Chicago. Bucketing it on UTC would move a truck's
    // last evening reading into the next day and, with it, a night's driving into the next period.
    const days = lastReadingEachDay([sample("2026-07-07T04:30:00Z", 777)], CHICAGO);
    expect(days.map((d) => d.day)).toEqual(["2026-07-06"]);
  });

  it("records the offset the slot was cut on, and it follows DST", () => {
    const winter = lastReadingEachDay([sample("2026-01-15T18:00:00Z", 1)], CHICAGO);
    const summer = lastReadingEachDay([sample("2026-07-15T18:00:00Z", 2)], CHICAGO);
    expect(winter[0]!.tzOffsetMinutes).toBe(-360);
    expect(summer[0]!.tzOffsetMinutes).toBe(-300);
  });

  it("keeps metres exactly as the vendor sent them", () => {
    // A miles figure here would bake this month's conversion and rounding into stored data, and
    // history could not be corrected without re-fetching a period Samsara may since have restated.
    const days = lastReadingEachDay([sample("2026-07-06T20:00:00Z", 663_428_113.5)], CHICAGO);
    expect(days[0]!.meters).toBe(663_428_113.5);
  });

  it("drops a sample whose value is not a usable counter", () => {
    // A cumulative counter cannot be negative: a negative value is a sentinel or a parse artefact,
    // and one metre away from a fleet denominator it would become a nonsense subtraction.
    const days = lastReadingEachDay(
      [
        sample("2026-07-06T10:00:00Z", 400_000),
        sample("2026-07-06T22:00:00Z", -1),
        sample("2026-07-06T23:00:00Z", Number.NaN),
      ],
      CHICAGO,
    );
    expect(days).toHaveLength(1);
    expect(days[0]!.meters).toBe(400_000);
  });

  it("drops a sample whose instant cannot be read, rather than dating it today", () => {
    const days = lastReadingEachDay(
      [sample("not-a-time", 999), sample("2026-07-06T20:00:00Z", 500)],
      CHICAGO,
    );
    expect(days).toEqual([
      { day: "2026-07-06", readingAt: "2026-07-06T20:00:00Z", meters: 500, tzOffsetMinutes: -300 },
    ]);
  });

  it("returns days oldest first", () => {
    const days = lastReadingEachDay(
      [
        sample("2026-07-08T20:00:00Z", 3),
        sample("2026-07-06T20:00:00Z", 1),
        sample("2026-07-07T20:00:00Z", 2),
      ],
      CHICAGO,
    );
    expect(days.map((d) => d.day)).toEqual(["2026-07-06", "2026-07-07", "2026-07-08"]);
  });

  it("falls back to UTC days with a zero offset when the fleet has no timezone", () => {
    const days = lastReadingEachDay([sample("2026-07-07T04:30:00Z", 42)], null);
    expect(days).toEqual([
      { day: "2026-07-07", readingAt: "2026-07-07T04:30:00Z", meters: 42, tzOffsetMinutes: 0 },
    ]);
  });

  it("has nothing to say about a truck that reported nothing", () => {
    expect(lastReadingEachDay([], CHICAGO)).toEqual([]);
  });
});
