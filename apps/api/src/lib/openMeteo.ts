import type { Env } from "../env.js";

export type OpenMeteoDay = { time: string[]; temperatureF: (number | null)[] };
/** Fetch one UTC day of hourly 2m temperature (°F) for a grid cell. Returns null on any error (best-effort). */
export type OpenMeteoFetcher = (
  latGrid: number,
  lngGrid: number,
  dateUtc: string,
) => Promise<OpenMeteoDay | null>;

/**
 * Real Open-Meteo fetcher (free, no API key). Uses the forecast endpoint with an explicit start/end date, which
 * covers the recent past (well within our 30-day idle window). Best-effort: any failure returns null so the
 * caller leaves the event's temperature unfilled (→ classified 'undetermined', never counted as waste).
 */
export function makeOpenMeteoFetcher(env: Env): OpenMeteoFetcher {
  return async (latGrid, lngGrid, dateUtc) => {
    try {
      const url = new URL(env.OPEN_METEO_URL);
      url.searchParams.set("latitude", String(latGrid));
      url.searchParams.set("longitude", String(lngGrid));
      url.searchParams.set("start_date", dateUtc);
      url.searchParams.set("end_date", dateUtc);
      url.searchParams.set("hourly", "temperature_2m");
      url.searchParams.set("temperature_unit", "fahrenheit");
      url.searchParams.set("timezone", "UTC");
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const j = (await res.json()) as {
        hourly?: { time?: string[]; temperature_2m?: (number | null)[] };
      };
      const time = j.hourly?.time ?? [];
      const temperatureF = j.hourly?.temperature_2m ?? [];
      if (time.length === 0) return null;
      return { time, temperatureF };
    } catch {
      return null;
    }
  };
}
