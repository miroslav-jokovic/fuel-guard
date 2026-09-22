/**
 * Pure helpers for the idle temperature backfill (CP2). The I/O (Open-Meteo fetch + weather_cache) lives in the
 * API; these are the testable bits: which grid cell + day an event maps to, and picking the right hour's temp.
 */

/** Coarse grid cell (~0.1° ≈ 11 km) for caching weather — idle events cluster at depots/truck stops, so a coarse
 *  cell keeps external calls bounded without meaningfully changing the temperature. */
export function weatherGridCell(lat: number, lng: number): { latGrid: number; lngGrid: number } {
  return { latGrid: Math.round(lat * 10) / 10, lngGrid: Math.round(lng * 10) / 10 };
}

/** UTC calendar date (YYYY-MM-DD) of an ISO timestamp — the day we fetch hourly temps for. */
export function utcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Already carries a zone designator — a trailing `Z`, or a `±HH:MM` / `±HHMM` offset.
 *
 * ⚠ THIS EXISTS BECAUSE THE SERIES HAS TWO SOURCES THAT DISAGREE ABOUT FORMAT, AND ONE OF THEM WAS
 * SILENTLY UNPARSEABLE FOR MONTHS. Open-Meteo sends naive UTC (`2026-06-14T00:00`), which needs a
 * `Z` appended. `weather_cache` is read back through PostgREST, which serialises `timestamptz` as
 * `2026-06-14T00:00:00+00:00` — verified against the live REST endpoint 2026-09-22. The previous
 * test, `raw.endsWith("Z")`, was false for the second shape, so the helper built
 * `…+00:00Z`, `Date.parse` returned **NaN**, every cached hour was skipped, and the function
 * returned null. A temperature was therefore only ever available from a LIVE fetch — and since the
 * cell is cached immediately after, the SECOND read of any cell was null forever.
 *
 * Measured cost: `idle_park_sessions` ambient coverage ran Apr 36% · May 39% · Jun 46% · Jul 18% ·
 * **Aug 0% · Sep 0.18%** (80 h known against 63,683 h unknown), collapsing exactly when park
 * sessions gained their own lat/lng and stopped borrowing `idle_events.air_temp_f`. Downstream,
 * `computeAvoidable` scores an Optimized-Idle truck on `insideSec` alone, so zero evidence meant
 * zero avoidable AND `envelopeCanJudge` false — 17 trucks left the idle verdict without a trace and
 * `optimized_envelope_status` has never once read `evidenced`. 734,136 cached hours had never been
 * read. Full write-up: `docs/plans/roster/FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md` §1.11 (D-FC6).
 *
 * A bare calendar date (`2026-06-14`) must NOT match: its trailing `-14` is a two-digit group, and
 * an offset needs four digits after the sign.
 */
const hasZoneDesignator = (iso: string): boolean => /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);

/** Pick the temperature (°F) for the hour nearest an event time from a day's hourly series.
 *  Accepts BOTH shapes the series arrives in — see `hasZoneDesignator`.
 *  Returns null when there's no series, no finite reading, or the nearest hour is more than ~90 min away. */
export function pickHourlyTempF(
  hourly: { time: string[]; temperatureF: (number | null)[] } | null | undefined,
  whenIso: string,
): number | null {
  if (!hourly || !hourly.time || hourly.time.length === 0) return null;
  const t = Date.parse(whenIso);
  if (!Number.isFinite(t)) return null;
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < hourly.time.length; i++) {
    const raw = hourly.time[i]!;
    const ht = Date.parse(hasZoneDesignator(raw) ? raw : raw + "Z");
    if (!Number.isFinite(ht)) continue;
    const d = Math.abs(ht - t);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  if (best < 0 || bestDiff > 90 * 60_000) return null;
  const v = hourly.temperatureF[best];
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
}

/**
 * Split a park session into one thermal interval per clock hour it spans, each carrying that hour's
 * temperature from the day series.
 *
 * The idle-equipment envelope asks "how many of these idle seconds were inside the equipment's capable
 * temperature band" — a question about the whole park, not a single instant. `pickHourlyTempF` answers for
 * one moment, which is right for an idle EVENT but wrong for a 10-hour sleeper park that can start at 78°F
 * and end at 41°F. Splitting on the hour lets those seconds land in different buckets instead of all taking
 * the temperature the park happened to begin at.
 *
 * Hours with no reading yield an interval with `tempF: null` — the envelope counts those as unknown and
 * excludes them, so a gap in the weather series can only shrink the verdict, never skew it.
 */
export function hourlyThermalIntervals(
  startMs: number,
  endMs: number,
  hourlyByDay: (day: string) => { time: string[]; temperatureF: (number | null)[] } | null | undefined,
): { startMs: number; endMs: number; tempF: number | null }[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs)) return [];
  const HOUR_MS = 3_600_000;
  const out: { startMs: number; endMs: number; tempF: number | null }[] = [];
  for (let from = startMs; from < endMs; ) {
    const to = Math.min(endMs, Math.floor(from / HOUR_MS) * HOUR_MS + HOUR_MS);
    if (!(to > from)) break;
    const atIso = new Date(from).toISOString();
    out.push({ startMs: from, endMs: to, tempF: pickHourlyTempF(hourlyByDay(atIso.slice(0, 10)), atIso) });
    from = to;
  }
  return out;
}
