/**
 * WP7 — regional posted-diesel market median for the cost_outlier market variant. Reads the GLOBAL
 * posted-price layer (fuel_prices_posted ⋈ fuel_stations.state): median station price in the fill's
 * state over ±3 days, USD/gal, posted (card) prices only — cash quotes are a different product and are
 * never blended (0064). Needs ≥5 station-price samples, else null (no market → variant stays silent).
 * Memoized per (state, day) so a rebuild doesn't re-query per fill.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const WINDOW_DAYS = 3;
const MIN_SAMPLES = 5;
const memo = new Map<string, number | null>();
const MEMO_CAP = 1000;

export async function loadMarketPricePerGal(
  admin: SupabaseClient,
  state: string | null | undefined,
  fueledAt: string,
): Promise<number | null> {
  const st = (state ?? "").trim().toUpperCase();
  if (!st) return null;
  const day = fueledAt.slice(0, 10);
  const key = `${st}|${day}`;
  if (memo.has(key)) return memo.get(key)!;

  const t = Date.parse(fueledAt);
  const from = new Date(t - WINDOW_DAYS * 86_400_000).toISOString();
  const to = new Date(t + WINDOW_DAYS * 86_400_000).toISOString();
  const { data } = await admin
    .from("fuel_prices_posted")
    .select("price, station_id, fuel_stations!inner(state)")
    .eq("product", "diesel")
    .eq("unit", "gal")
    .eq("currency", "USD")
    .eq("price_kind", "posted")
    .eq("fuel_stations.state", st)
    .gte("observed_at", from)
    .lte("observed_at", to)
    .limit(2000);
  const rows = (data ?? []) as { price: number | string; station_id: string }[];

  // One vote per STATION (its latest-window price would be ideal; median of medians is robust enough):
  const byStation = new Map<string, number[]>();
  for (const r of rows) {
    const p = Number(r.price);
    if (!Number.isFinite(p) || p <= 0) continue;
    (byStation.get(r.station_id) ?? byStation.set(r.station_id, []).get(r.station_id)!).push(p);
  }
  const stationPrices = [...byStation.values()].map((ps) => median(ps));
  const result = stationPrices.length >= MIN_SAMPLES ? Math.round(median(stationPrices) * 1000) / 1000 : null;

  if (memo.size >= MEMO_CAP) memo.clear();
  memo.set(key, result);
  return result;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
