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

/**
 * The series reaches this module from TWO sources with different timestamp shapes, and every test
 * above uses only the first one — which is the whole reason the second went unparseable for months
 * without a single failure (D-FC6, `docs/plans/roster/FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md` §1.11).
 *
 *   Open-Meteo, live   `2026-07-08T04:00`              naive UTC, needs a `Z`
 *   weather_cache      `2026-07-08T04:00:00+00:00`     PostgREST's `timestamptz`, already zoned
 *
 * The old test was `raw.endsWith("Z")`, so the cached shape got a `Z` appended to an offset it
 * already had, `Date.parse` returned NaN, and 734,136 cached hours read as "no temperature".
 */
describe("pickHourlyTempF across both timestamp shapes", () => {
  const CACHED = "2026-07-08T04:00:00+00:00"; // exactly what PostgREST returns for `hour_utc`

  it("reads a temperature out of a PostgREST-shaped series", () => {
    expect(pickHourlyTempF({ time: [CACHED], temperatureF: [64] }, "2026-07-08T04:10:00Z")).toBe(64);
  });

  it("agrees with the Open-Meteo shape for the same instant", () => {
    const when = "2026-07-08T04:10:00Z";
    const naive = pickHourlyTempF({ time: ["2026-07-08T04:00"], temperatureF: [64] }, when);
    const cached = pickHourlyTempF({ time: [CACHED], temperatureF: [64] }, when);
    expect(cached).toBe(naive);
  });

  it("honours a non-UTC offset rather than reading it as UTC", () => {
    // 04:00-05:00 IS 09:00Z. Treated as UTC it would sit five hours from the event and be refused by
    // the 90-minute bound, so a passing assertion here proves the offset was applied, not ignored.
    expect(
      pickHourlyTempF({ time: ["2026-07-08T04:00:00-05:00"], temperatureF: [64] }, "2026-07-08T09:05:00Z"),
    ).toBe(64);
  });

  it("reads a zoneless timestamp as UTC even when the machine is not", () => {
    /**
     * The guard on the fix's own blast radius: the date part's `-08` must not be read as an offset,
     * or every naive Open-Meteo series would silently start being parsed as LOCAL time.
     *
     * ⚠ THE FORCED ZONE IS THE TEST. In UTC, "local" and "UTC" are the same instant, so this
     * assertion cannot distinguish a correct predicate from a misanchored one — and CI runs UTC.
     * A first draft asserted on a bare date (`2026-07-08`), which `Date.parse` resolves identically
     * with and without a `Z`; it survived every mutation and proved nothing. Asia/Tokyo puts a
     * misparse 9 hours out, far past the 90-minute bound, so the answer flips to null.
     */
    // `process` through `globalThis` and the precondition ASSERTED, not optional-chained — the
    // idiom `displayDate.test.ts` established for this package, which carries no node types.
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    expect(env, "this test needs process.env.TZ to pin a timezone").toBeDefined();
    const wasTz = env!.TZ;
    env!.TZ = "Asia/Tokyo";
    try {
      // The pin itself, named: if this stops being true the zone is no longer being forced and the
      // assertion under it has quietly gone back to proving nothing on a UTC runner.
      expect(Date.parse("2026-07-08T04:00")).not.toBe(Date.parse("2026-07-08T04:00Z"));
      expect(
        pickHourlyTempF({ time: ["2026-07-08T04:00"], temperatureF: [64] }, "2026-07-08T04:10:00Z"),
      ).toBe(64);
    } finally {
      env!.TZ = wasTz;
    }
  });

  it("carries the fix through hourlyThermalIntervals, which is what the envelope actually calls", () => {
    const cachedDay = {
      time: ["2026-01-02T00:00:00+00:00", "2026-01-02T01:00:00+00:00"],
      temperatureF: [10, 20] as (number | null)[],
    };
    const ms = (h: number) => Date.parse(`2026-01-02T0${h}:00:00Z`);
    expect(hourlyThermalIntervals(ms(0), ms(2), (d) => (d === "2026-01-02" ? cachedDay : null))).toEqual([
      { startMs: ms(0), endMs: ms(1), tempF: 10 },
      { startMs: ms(1), endMs: ms(2), tempF: 20 },
    ]);
  });
});
