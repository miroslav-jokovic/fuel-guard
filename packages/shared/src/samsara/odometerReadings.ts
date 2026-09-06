/**
 * Which odometer samples a day's collection keeps (W3b).
 *
 * Samsara's `/fleet/vehicles/stats/history` returns every reading it holds — at telematics ping
 * rates that is hundreds per truck per day, and Q-SAM5 declined a store of that density: ~200k rows
 * a day to answer a question that needs two readings per period. So the collector keeps ONE reading
 * per truck per day per counter, and this is the rule that chooses it.
 *
 * **The last of the day, and that choice is not arbitrary.** `distanceByVehicle` measures a period
 * as `odometer(end) − odometer(start)`, where each end is the last reading AT OR BEFORE that
 * instant — what a dashboard odometer would have shown at that moment. With one reading late in
 * each day, a period that runs to midnight is answered by the reading nearest to it. Keeping the
 * FIRST of each day instead would answer a Monday-to-Monday week with Sunday morning's odometer and
 * report six days of driving as seven days' worth: a 14% undercount that no total contradicts.
 *
 * **A day with no sample produces no entry, never a zero.** History thins at the old edge — 10.8%
 * of vehicle-days are `no_data` at 2026-01 against 0.6% at 2026-08 (SAMSARA-COLLECTION-PLAN) — and a
 * zero-metre reading would not read as "the truck did not report", it would read as a counter that
 * reset to the factory, which is the one thing `distanceByVehicle` treats as a hardware event.
 *
 * Pure: no clock, no I/O. The timezone is a parameter, because the day is a slot cut on the fleet's
 * operating clock and a collector must not consult the machine's.
 */
import { dayInTz } from "../dashboard.js";
import { zonedWallTimeToUtcIso } from "../efsImport/dateTime.js";

/** One `{time, value}` pair as Samsara serves it, with the value already read as a number. */
export interface OdometerStatSample {
  /** The vendor's own instant, ISO 8601. */
  time: string;
  /** The cumulative counter, in metres, exactly as Samsara reported it. */
  meters: number;
}

/** The one reading a day keeps, ready to be staged verbatim. */
export interface DailyOdometerReading {
  /** The slot (YYYY-MM-DD) in the fleet's operating clock. A dedup key, never a figure's input. */
  day: string;
  /** The vendor's instant for the reading that was kept. */
  readingAt: string;
  /** The counter, in metres, unconverted. */
  meters: number;
  /** The UTC offset (minutes) the slot was cut on — e.g. -360 US Central, -300 the same fleet on DST. */
  tzOffsetMinutes: number;
}

const utcMidnightMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/**
 * The offset in force on that local day, computed the same way `aggregateEngineDays` computes it, so
 * two tables that both claim to cut days on the fleet's clock agree about what that means.
 */
function dayOffsetMinutes(day: string, tz: string | null | undefined): number {
  if (!tz) return 0;
  const localMidnight = Date.parse(zonedWallTimeToUtcIso(day, "00:00:00", tz));
  if (!Number.isFinite(localMidnight)) return 0;
  return Math.round((utcMidnightMs(day) - localMidnight) / 60_000);
}

/**
 * The last usable reading of each local day, oldest day first.
 *
 * A sample is dropped, rather than corrected, when its instant is unparseable or its value is not a
 * finite non-negative number: a cumulative counter cannot be negative, so a negative value is a
 * sentinel or a parse artefact and never a reading. Samples that tie on the instant keep the LAST
 * the vendor sent — a later entry in a page is its more recent statement about that moment.
 */
export function lastReadingEachDay(
  samples: readonly OdometerStatSample[],
  tz: string | null | undefined,
): DailyOdometerReading[] {
  const kept = new Map<string, { readingAt: string; ms: number; meters: number }>();
  for (const sample of samples) {
    const ms = Date.parse(sample.time);
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(sample.meters) || sample.meters < 0) continue;
    const day = dayInTz(new Date(ms).toISOString(), tz ?? null);
    const current = kept.get(day);
    if (!current || ms >= current.ms) {
      kept.set(day, { readingAt: sample.time, ms, meters: sample.meters });
    }
  }
  return [...kept.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, r]) => ({
      day,
      readingAt: r.readingAt,
      meters: r.meters,
      tzOffsetMinutes: dayOffsetMinutes(day, tz),
    }));
}
