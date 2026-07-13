import type { SupabaseClient } from "@supabase/supabase-js";
import { weatherGridCell, utcDate, pickHourlyTempF } from "@fuelguard/shared";
import type { OpenMeteoFetcher, OpenMeteoDay } from "../lib/openMeteo.js";

export interface BackfillInput {
  eventUuid: string;
  lat: number | null;
  lng: number | null;
  startTime: string;
}

/**
 * Backfill ambient temperature for idle events Samsara didn't report one for, using Open-Meteo history keyed by a
 * coarse grid cell + UTC day (persisted in weather_cache so re-syncs don't refetch). Best-effort: any failure
 * leaves the event unfilled (→ 'undetermined', never counted as waste). Returns eventUuid → °F for the ones filled.
 */
export async function backfillTemperatures(
  admin: SupabaseClient,
  events: BackfillInput[],
  fetcher: OpenMeteoFetcher,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const targets = events.filter((e) => e.lat != null && e.lng != null);
  if (targets.length === 0) return out;

  const cellKey = (latGrid: number, lngGrid: number, dateUtc: string) =>
    `${latGrid},${lngGrid},${dateUtc}`;

  // Unique (grid, day) cells we need a temperature series for.
  const cells = new Map<string, { latGrid: number; lngGrid: number; dateUtc: string }>();
  for (const e of targets) {
    const { latGrid, lngGrid } = weatherGridCell(e.lat as number, e.lng as number);
    const dateUtc = utcDate(e.startTime);
    cells.set(cellKey(latGrid, lngGrid, dateUtc), { latGrid, lngGrid, dateUtc });
  }

  // Resolve each cell: cached day if present, else fetch + persist the day's hours.
  const dayByCell = new Map<string, OpenMeteoDay>();
  for (const [key, c] of cells) {
    const { data: cached } = await admin
      .from("weather_cache")
      .select("hour_utc, temp_f")
      .eq("lat_grid", c.latGrid)
      .eq("lng_grid", c.lngGrid)
      .gte("hour_utc", `${c.dateUtc}T00:00:00Z`)
      .lte("hour_utc", `${c.dateUtc}T23:59:59Z`);
    const rows = (cached ?? []) as { hour_utc: string; temp_f: number | string | null }[];
    if (rows.length > 0) {
      dayByCell.set(key, {
        time: rows.map((r) => r.hour_utc),
        temperatureF: rows.map((r) => (r.temp_f == null ? null : Number(r.temp_f))),
      });
      continue;
    }
    const day = await fetcher(c.latGrid, c.lngGrid, c.dateUtc);
    if (!day) continue;
    dayByCell.set(key, day);
    const toCache = day.time.map((t, i) => ({
      lat_grid: c.latGrid,
      lng_grid: c.lngGrid,
      hour_utc: t.endsWith("Z") ? t : t + "Z",
      temp_f: day.temperatureF[i] ?? null,
    }));
    if (toCache.length > 0) {
      await admin
        .from("weather_cache")
        .upsert(toCache, { onConflict: "lat_grid,lng_grid,hour_utc" });
    }
  }

  for (const e of targets) {
    const { latGrid, lngGrid } = weatherGridCell(e.lat as number, e.lng as number);
    const day = dayByCell.get(cellKey(latGrid, lngGrid, utcDate(e.startTime)));
    const temp = pickHourlyTempF(day, e.startTime);
    if (temp != null) out.set(e.eventUuid, temp);
  }
  return out;
}
