import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";

export interface Coords {
  lat: number;
  lng: number;
}

export interface StationQuery {
  name: string | null;
  city: string | null;
  state: string | null;
}

const norm = (s: string | null | undefined) => (s ?? "").trim();
const keyFor = (q: StationQuery) => [norm(q.name), norm(q.city), norm(q.state)].join("|").toLowerCase();

// Respect Nominatim's ~1 req/sec policy: serialize live lookups and space them out. Cache hits skip this.
let providerChain: Promise<unknown> = Promise.resolve();
function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = providerChain.then(fn);
  providerChain = run.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100)),
  );
  return run;
}

/**
 * Resolve a fuel station to coordinates, cached in geocode_cache so each distinct station is looked up
 * only once (a MISS is cached too, so we never re-hit the provider for an unresolvable station). Uses
 * OpenStreetMap/Nominatim by default (free, no key). Best-effort: returns null on any failure so the
 * caller falls back to the state-level location check.
 */
export async function geocodeStation(admin: SupabaseClient, env: Env, station: StationQuery): Promise<Coords | null> {
  if (!env.GEOCODING_ENABLED) return null;
  if (!norm(station.city) && !norm(station.state)) return null;

  const key = keyFor(station);
  const { data: cached } = await admin.from("geocode_cache").select("lat, lng, resolved").eq("query", key).maybeSingle();
  if (cached) {
    return cached.resolved && cached.lat != null && cached.lng != null
      ? { lat: Number(cached.lat), lng: Number(cached.lng) }
      : null;
  }

  let coords: Coords | null = null;
  try {
    coords = await throttle(() => queryNominatim(env, station));
  } catch (e) {
    console.error("[geocode] provider lookup failed:", e instanceof Error ? e.message : e);
  }

  await admin
    .from("geocode_cache")
    .upsert(
      { query: key, lat: coords?.lat ?? null, lng: coords?.lng ?? null, resolved: coords != null, provider: "nominatim" },
      { onConflict: "query" },
    );
  return coords;
}

async function queryNominatim(env: Env, station: StationQuery): Promise<Coords | null> {
  // Try the most specific query first (station name + city + state), then fall back to city + state.
  const attempts = [
    [station.name, station.city, station.state],
    [station.city, station.state],
  ];
  for (const parts of attempts) {
    const q = parts.map(norm).filter(Boolean).join(", ");
    if (!q) continue;
    const url = `${env.GEOCODE_URL}?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url, { headers: { "User-Agent": `FuelGuard/1.0 (${env.MAIL_FROM})` } });
    if (!res.ok) continue;
    const arr = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const hit = arr?.[0];
    if (hit?.lat && hit?.lon) return { lat: Number(hit.lat), lng: Number(hit.lon) };
  }
  return null;
}
