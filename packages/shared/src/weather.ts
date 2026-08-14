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

/** Pick the temperature (°F) for the hour nearest an event time from a day's hourly series (Open-Meteo shape).
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
    const ht = Date.parse(raw.endsWith("Z") ? raw : raw + "Z"); // Open-Meteo UTC times omit the trailing Z
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
