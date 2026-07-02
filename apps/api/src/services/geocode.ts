import type { SupabaseClient } from "@supabase/supabase-js";
import { parseStationIdentity } from "@fuelguard/shared";
import type { Env } from "../env.js";

export type GeoPrecision = "site" | "city";

export interface Coords {
  lat: number;
  lng: number;
  /** "site" = we resolved the specific station (tight radius can confirm); "city" = town centroid only. */
  precision: GeoPrecision;
}

export interface StationQuery {
  name: string | null;
  city: string | null;
  state: string | null;
}

const norm = (s: string | null | undefined) => (s ?? "").trim();

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
 * Resolve a fuel station to coordinates + a precision tier, cached in geocode_cache keyed by the
 * station identity (brand+store# when available — nationwide-unique — else name|city|state), so each
 * distinct station is looked up once. We try the SPECIFIC station first (brand/name + city + state) and
 * only fall back to the town; a result is "site" precision when it resolves to a real POI, "city" when
 * it's just the town centroid. Best-effort: returns null on any failure.
 */
export async function geocodeStation(admin: SupabaseClient, env: Env, station: StationQuery): Promise<Coords | null> {
  if (!env.GEOCODING_ENABLED) return null;
  if (!norm(station.city) && !norm(station.state) && !norm(station.name)) return null;

  const identity = parseStationIdentity(station.name, station.city, station.state);
  const key = identity.siteKey;

  const { data: cached } = await admin
    .from("geocode_cache")
    .select("lat, lng, resolved, precision")
    .eq("query", key)
    .maybeSingle();
  if (cached) {
    return cached.resolved && cached.lat != null && cached.lng != null
      ? { lat: Number(cached.lat), lng: Number(cached.lng), precision: (cached.precision as GeoPrecision) ?? "city" }
      : null;
  }

  let coords: Coords | null = null;
  try {
    coords = await throttle(() => queryNominatim(env, station, identity.brandLabel));
  } catch (e) {
    console.error("[geocode] provider lookup failed:", e instanceof Error ? e.message : e);
  }

  await admin.from("geocode_cache").upsert(
    {
      query: key,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      resolved: coords != null,
      precision: coords?.precision ?? null,
      provider: "nominatim",
    },
    { onConflict: "query" },
  );
  return coords;
}

// OSM classes that represent a real point-of-interest (a station) rather than a town/region centroid.
const POI_CLASSES = new Set(["amenity", "shop", "highway", "building", "tourism", "office"]);

async function queryNominatim(env: Env, station: StationQuery, brandLabel: string | null): Promise<Coords | null> {
  // Most specific → least. Brand/name + city + state target the station itself ("site"); the bare
  // city + state is the coarse fallback ("city").
  const siteAttempts = [
    [brandLabel ?? station.name, station.city, station.state],
    [station.name, station.city, station.state],
  ];
  for (const parts of siteAttempts) {
    const hit = await lookup(env, parts);
    if (hit) {
      const precision: GeoPrecision = POI_CLASSES.has(hit.klass) ? "site" : "city";
      return { lat: hit.lat, lng: hit.lng, precision };
    }
  }
  const cityHit = await lookup(env, [station.city, station.state]);
  return cityHit ? { lat: cityHit.lat, lng: cityHit.lng, precision: "city" } : null;
}

async function lookup(env: Env, parts: (string | null)[]): Promise<{ lat: number; lng: number; klass: string } | null> {
  const q = parts.map(norm).filter(Boolean).join(", ");
  if (!q) return null;
  const url = `${env.GEOCODE_URL}?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us&addressdetails=0`;
  const res = await fetch(url, { headers: { "User-Agent": `FuelGuard/1.0 (${env.MAIL_FROM})` } });
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<{ lat?: string; lon?: string; class?: string }>;
  const hit = arr?.[0];
  if (!hit?.lat || !hit?.lon) return null;
  return { lat: Number(hit.lat), lng: Number(hit.lon), klass: hit.class ?? "" };
}
