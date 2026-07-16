/**
 * Forward/reverse geocoding + POI discovery via HERE (reuses HERE_API_KEY — same provider as routing, no
 * extra billing). Used to place Pilot sites, which arrive as city+state only in the daily price report.
 *
 * Bulk geocoding hits HERE's per-second rate limit, which returns HTTP 429; every helper here retries 429/5xx
 * with exponential backoff so a burst self-paces instead of dropping sites. Best-effort: null after retries.
 */
import type { Env } from "../env.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a HERE JSON endpoint with retry on 429 / 5xx. Returns parsed JSON, or null on a hard failure. */
async function hereGet(url: string, attempts = 5): Promise<unknown | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        await sleep(Math.min(8000, 400 * 2 ** i)); // 400,800,1600,3200,6400ms
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await sleep(Math.min(8000, 400 * 2 ** i));
    }
  }
  return null;
}

export async function hereGeocode(env: Env, query: string): Promise<{ lat: number; lng: number } | null> {
  if (!env.HERE_API_KEY) return null;
  const q = query.trim();
  if (!q) return null;
  const url =
    `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(q)}` +
    `&in=countryCode:USA,CAN&limit=1&apiKey=${encodeURIComponent(env.HERE_API_KEY)}`;
  const body = (await hereGet(url)) as { items?: Array<{ position?: { lat?: number; lng?: number } }> } | null;
  const pos = body?.items?.[0]?.position;
  return pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng) ? { lat: pos.lat!, lng: pos.lng! } : null;
}

/** POI search near a focus point — finds a named place (a Pilot Travel Center) that /geocode can't resolve. */
export async function hereDiscover(env: Env, q: string, at: { lat: number; lng: number }, radiusM = 25000): Promise<{ lat: number; lng: number } | null> {
  if (!env.HERE_API_KEY) return null;
  const url =
    `https://discover.search.hereapi.com/v1/discover?q=${encodeURIComponent(q)}` +
    `&in=circle:${at.lat},${at.lng};r=${radiusM}&limit=1&apiKey=${encodeURIComponent(env.HERE_API_KEY)}`;
  const body = (await hereGet(url)) as { items?: Array<{ position?: { lat?: number; lng?: number } }> } | null;
  const pos = body?.items?.[0]?.position;
  return pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng) ? { lat: pos.lat!, lng: pos.lng! } : null;
}

/** Reverse-geocode a coordinate to a human address label via HERE. Best-effort. */
export async function hereReverseGeocode(env: Env, lat: number, lng: number): Promise<string | null> {
  if (!env.HERE_API_KEY) return null;
  const url = `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lng}&limit=1&apiKey=${encodeURIComponent(env.HERE_API_KEY)}`;
  const body = (await hereGet(url)) as { items?: Array<{ address?: { label?: string }; title?: string }> } | null;
  return body?.items?.[0]?.address?.label ?? body?.items?.[0]?.title ?? null;
}

/**
 * Reverse-geocode a coordinate to its US/CA state code (e.g. "CA"). Best-effort → null on failure.
 * Used to locate where a route crosses into an avoided state (California-border top-off).
 */
export async function hereReverseGeocodeState(env: Env, lat: number, lng: number): Promise<string | null> {
  if (!env.HERE_API_KEY) return null;
  const url = `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lng}&limit=1&apiKey=${encodeURIComponent(env.HERE_API_KEY)}`;
  const body = (await hereGet(url)) as { items?: Array<{ address?: { stateCode?: string } }> } | null;
  const code = body?.items?.[0]?.address?.stateCode;
  return code ? code.toUpperCase() : null;
}

/** Run `worker` over `items` with bounded concurrency; preserves order. Stops starting new work after
 *  `deadlineMs` (epoch) if given, resolving the rest to whatever the worker returns for a skipped item. */
export async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
  return results;
}
