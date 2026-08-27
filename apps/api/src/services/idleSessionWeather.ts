import type { SupabaseClient } from "@supabase/supabase-js";
import {
  weatherGridCell,
  utcDate,
  hourlyThermalIntervals,
  type IdleThermalInterval,
} from "@silvicom/shared";
import type { OpenMeteoFetcher, OpenMeteoDay } from "../lib/openMeteo.js";

/**
 * Ambient temperature for a park session, from the session's OWN location.
 *
 * WHY (audit 2026-08-13). The Optimized-Idle envelope needs to know how warm it was while a truck sat
 * idling, and the only source of that was `idle_events.air_temp_f`, borrowed by time overlap. A park session
 * is derived from engineStates; an idle event comes from Samsara's own detector with a 2-minute floor. They
 * describe the same reality but never align exactly, so 51% of sessions had at least one second of idle with
 * no temperature over it — and under the old all-or-nothing rule that zeroed every Optimized-Idle truck in
 * the fleet.
 *
 * Nothing about that dependency was necessary. `/fleet/vehicles/stats/history?decorations=gps`, which the
 * idle sync already calls, returns latitude/longitude on every engineStates sample, so a park session can
 * carry its own fix (migration 0188) and read its own weather from the same Open-Meteo grid cache the idle
 * events use (migration 0049). No extra Samsara calls, no borrowed rows, no inherited gaps.
 *
 * Resolution is HOURLY across the park rather than one reading at its start: a ten-hour sleeper park can
 * begin at 78°F and end at 41°F, and those seconds belong in different envelope buckets.
 */

export interface SessionWeatherInput {
  id: string;
  lat: number | null;
  lng: number | null;
  startedAtMs: number;
  endedAtMs: number;
}

/** Cap on distinct (grid cell, UTC day) pairs resolved per run — each miss is one Open-Meteo call. */
const MAX_CELLS_PER_RUN = 400;

const cellKey = (latGrid: number, lngGrid: number, dateUtc: string): string =>
  `${latGrid},${lngGrid},${dateUtc}`;

/** Every (grid cell, UTC day) a session touches — a park spanning midnight needs both days. */
function cellsFor(session: SessionWeatherInput): { latGrid: number; lngGrid: number; dateUtc: string }[] {
  if (session.lat == null || session.lng == null) return [];
  const { latGrid, lngGrid } = weatherGridCell(session.lat, session.lng);
  const out: { latGrid: number; lngGrid: number; dateUtc: string }[] = [];
  const seen = new Set<string>();
  for (let ms = session.startedAtMs; ms < session.endedAtMs; ms += 3_600_000) {
    const dateUtc = utcDate(new Date(ms).toISOString());
    if (seen.has(dateUtc)) continue;
    seen.add(dateUtc);
    out.push({ latGrid, lngGrid, dateUtc });
  }
  const endDate = utcDate(new Date(session.endedAtMs).toISOString());
  if (!seen.has(endDate)) out.push({ latGrid, lngGrid, dateUtc: endDate });
  return out;
}

async function readCachedDay(
  admin: SupabaseClient,
  cell: { latGrid: number; lngGrid: number; dateUtc: string },
): Promise<OpenMeteoDay | null> {
  const { data } = await admin
    .from("weather_cache")
    .select("hour_utc, temp_f")
    .eq("lat_grid", cell.latGrid)
    .eq("lng_grid", cell.lngGrid)
    .gte("hour_utc", `${cell.dateUtc}T00:00:00Z`)
    .lte("hour_utc", `${cell.dateUtc}T23:59:59Z`);
  const rows = (data ?? []) as { hour_utc: string; temp_f: number | string | null }[];
  if (rows.length === 0) return null;
  return {
    time: rows.map((r) => r.hour_utc),
    temperatureF: rows.map((r) => (r.temp_f == null ? null : Number(r.temp_f))),
  };
}

/**
 * Resolve hourly thermal intervals for each session that has a location. Sessions without one are absent
 * from the result — the caller falls back to its previous source rather than assuming a temperature.
 *
 * Best-effort throughout: a cell that cannot be fetched simply yields null-temperature hours, which the
 * envelope treats as unknown and excludes. Weather is never allowed to fail a sync.
 */
export async function resolveSessionThermalIntervals(
  admin: SupabaseClient,
  sessions: readonly SessionWeatherInput[],
  fetcher: OpenMeteoFetcher,
): Promise<Map<string, IdleThermalInterval[]>> {
  const located = sessions.filter(
    (s) => s.lat != null && s.lng != null && Number.isFinite(s.startedAtMs) && s.endedAtMs > s.startedAtMs,
  );
  const out = new Map<string, IdleThermalInterval[]>();
  if (located.length === 0) return out;

  const cells = new Map<string, { latGrid: number; lngGrid: number; dateUtc: string }>();
  for (const session of located)
    for (const cell of cellsFor(session)) cells.set(cellKey(cell.latGrid, cell.lngGrid, cell.dateUtc), cell);

  const dayByCell = new Map<string, OpenMeteoDay>();
  let fetched = 0;
  for (const [key, cell] of cells) {
    const cached = await readCachedDay(admin, cell);
    if (cached) {
      dayByCell.set(key, cached);
      continue;
    }
    // Bound the external calls a single run can make; unresolved cells become unknown hours, not failures.
    if (fetched >= MAX_CELLS_PER_RUN) continue;
    fetched += 1;
    const day = await fetcher(cell.latGrid, cell.lngGrid, cell.dateUtc).catch(() => null);
    if (!day) continue;
    dayByCell.set(key, day);
    const toCache = day.time.map((t, i) => ({
      lat_grid: cell.latGrid,
      lng_grid: cell.lngGrid,
      hour_utc: t.endsWith("Z") ? t : `${t}Z`,
      temp_f: day.temperatureF[i] ?? null,
    }));
    if (toCache.length > 0)
      await admin
        .from("weather_cache")
        .upsert(toCache, { onConflict: "lat_grid,lng_grid,hour_utc" })
        .then(undefined, () => undefined); // cache write is an optimization, never a hard failure
  }

  for (const session of located) {
    const { latGrid, lngGrid } = weatherGridCell(session.lat as number, session.lng as number);
    out.set(
      session.id,
      hourlyThermalIntervals(session.startedAtMs, session.endedAtMs, (dateUtc) =>
        dayByCell.get(cellKey(latGrid, lngGrid, dateUtc)),
      ),
    );
  }
  return out;
}
