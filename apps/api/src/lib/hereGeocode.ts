/**
 * Forward geocoding via HERE (reuses HERE_API_KEY — the same provider that builds the routes, no extra
 * billing, and far higher throughput than Nominatim's 1 req/s). Used to place Pilot sites, which arrive as
 * city+state only in the daily price report. Best-effort: returns null on any failure.
 */
import type { Env } from "../env.js";

export async function hereGeocode(env: Env, query: string): Promise<{ lat: number; lng: number } | null> {
  if (!env.HERE_API_KEY) return null;
  const q = query.trim();
  if (!q) return null;
  const url =
    `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(q)}` +
    `&in=countryCode:USA,CAN&limit=1&apiKey=${encodeURIComponent(env.HERE_API_KEY)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: Array<{ position?: { lat?: number; lng?: number } }> };
    const pos = body.items?.[0]?.position;
    if (pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng)) return { lat: pos.lat!, lng: pos.lng! };
    return null;
  } catch {
    return null;
  }
}

/** Reverse-geocode a coordinate to a human address label via HERE. Best-effort. */
export async function hereReverseGeocode(env: Env, lat: number, lng: number): Promise<string | null> {
  if (!env.HERE_API_KEY) return null;
  const url = `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lng}&limit=1&apiKey=${encodeURIComponent(env.HERE_API_KEY)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: Array<{ address?: { label?: string }; title?: string }> };
    return body.items?.[0]?.address?.label ?? body.items?.[0]?.title ?? null;
  } catch {
    return null;
  }
}

/** Run `worker` over `items` with bounded concurrency; preserves order. */
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
