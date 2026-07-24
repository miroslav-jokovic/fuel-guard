/**
 * WP6 — ambient temperature for FILLS (reusing the idle-events Open-Meteo machinery + weather_cache).
 * Backfills fuel_transactions.ambient_temp_f for recent fills that have coordinates and a RELIABLE
 * instant; the MPG cold-weather derate then runs off real cold instead of calendar months. Rows with
 * no coordinates or a date-only timestamp are left null → scoring falls back to the calendar derate
 * (never guesses a temperature off a noon sentinel). Best-effort; failures leave rows unfilled.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isNoonSentinelIso } from "@fuelguard/shared";
import type { OpenMeteoFetcher } from "../lib/openMeteo.js";
import { backfillTemperatures } from "./weatherBackfill.js";

const PAGE = 500;

export async function backfillFillWeather(
  admin: SupabaseClient,
  orgId: string,
  fetcher: OpenMeteoFetcher,
  sinceDays = 30,
): Promise<number> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data } = await admin
    .from("fuel_transactions")
    .select("id, fueled_at, samsara_recon_at, station_lat, station_lng, samsara_observed_lat, samsara_observed_lng")
    .eq("org_id", orgId)
    .gte("fueled_at", since)
    .is("ambient_temp_f", null)
    .order("fueled_at", { ascending: false })
    .limit(PAGE);
  const rows = (data ?? []) as {
    id: string;
    fueled_at: string;
    samsara_recon_at: string | null;
    station_lat: number | string | null;
    station_lng: number | string | null;
    samsara_observed_lat: number | string | null;
    samsara_observed_lng: number | string | null;
  }[];

  const targets = rows
    .map((r) => {
      const lat = r.station_lat ?? r.samsara_observed_lat;
      const lng = r.station_lng ?? r.samsara_observed_lng;
      // Reliable instant: the telematics-recovered time, else a real (non-sentinel) business timestamp.
      const when = r.samsara_recon_at ?? (isNoonSentinelIso(r.fueled_at) ? null : r.fueled_at);
      if (lat == null || lng == null || when == null) return null;
      return { eventUuid: r.id, lat: Number(lat), lng: Number(lng), startTime: when };
    })
    .filter((x): x is { eventUuid: string; lat: number; lng: number; startTime: string } => x != null);
  if (!targets.length) return 0;

  const temps = await backfillTemperatures(admin, targets, fetcher);
  let filled = 0;
  for (const [id, tempF] of temps) {
    await admin.from("fuel_transactions").update({ ambient_temp_f: tempF }).eq("id", id).eq("org_id", orgId);
    filled += 1;
  }
  return filled;
}
