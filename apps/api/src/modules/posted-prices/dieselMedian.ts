/**
 * The recent posted-diesel median for one org, served from the collector that owns the board (Q9,
 * `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` §7.2).
 *
 * ── WHY IT IS HERE AND NOT IN `idle`, WHICH IS THE MODULE THAT WANTS IT ─────────────────────────
 * `fuel_prices` is `layer: raw` in `scripts/table-modules.json`, so `check-table-access.mjs` seals
 * it to this collector: a reader in `idle` would be a foreign module reaching into staging. §7.2b
 * already ruled the identical case the other way round — the dashboard's declined-attempt count
 * goes through `fuel`'s index rather than take a `raw-access-waiver`, because all 24 existing
 * waivers are an owner acting on its own table and a foreign shortcut would have been a new kind.
 * So the median is computed HERE, exported from this module's index, and `idle` calls it.
 *
 * ── WHY IT IS CACHED, MEASURED ─────────────────────────────────────────────────────────────────
 * PostgREST caps a response at 1,000 rows, so a 14-day window over this board is a PAGED read:
 * 7,503 rows in 8 sequential round trips, measured against production 2026-09-21 at **1,545 ms**.
 * That is affordable once per surface and unaffordable on every Dashboard load, which is what §7.2c
 * step 3 is about to put in front of it. The board is ingested a few times a day, so a 5-minute
 * entry is far inside the cadence of the data itself — and it is the same 5 minutes the browser
 * composable this replaces used for its own `refetchInterval`, so no surface becomes staler than it
 * was.
 *
 * ⚠ THE CACHE IS KEYED BY ORG, AND THAT IS A TENANCY BOUNDARY, NOT A PERFORMANCE DETAIL. The API
 * reads with the service role, which BYPASSES RLS, so an entry keyed by nothing would price one
 * carrier's idle off another carrier's board. The `liveMapBoardCache` header argues this at length;
 * the same rule applies, and `expectOrgScoped` proves the read underneath it is scoped.
 *
 * ⚠ The browser's version of this read asked for `.limit(5000)` and PostgREST answered with 1,000,
 * so the Idling page's median has always been "the 1,000 most recent rows" rather than the window
 * its own comment claims. Measured 2026-09-21: $5.978 capped against $5.873 over the whole window,
 * a 1.8% difference. Paging here is that defect being fixed, not a definition being changed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDLE_PRICE_LOOKBACK_DAYS, medianOf } from "@silvicom/shared";
import { eachPage } from "../../lib/paging.js";

/** How long a median may be served after the read that produced it STARTED. */
export const DIESEL_MEDIAN_TTL_MS = 300_000;

export interface DieselMedianOptions {
  lookbackDays?: number;
  /** Injected by tests; production reads the wall clock once, here. */
  nowMs?: number;
}

interface Entry {
  startedAtMs: number;
  median: Promise<number | null>;
}

const entries = new Map<string, Entry>();

/**
 * A fleet-representative CURRENT diesel price: the median of this org's recent posted truck-stop
 * diesel rows, net price preferred over posted. Null when the window collected nothing.
 */
export async function readRecentDieselMedian(
  admin: SupabaseClient,
  orgId: string,
  opts: DieselMedianOptions = {},
): Promise<number | null> {
  const lookbackDays = opts.lookbackDays ?? IDLE_PRICE_LOOKBACK_DAYS;
  const nowMs = opts.nowMs ?? Date.now();
  const key = `${orgId}|${lookbackDays}`;

  const hit = entries.get(key);
  if (hit && nowMs - hit.startedAtMs < DIESEL_MEDIAN_TTL_MS) return hit.median;

  const median = readMedian(admin, orgId, lookbackDays, nowMs);
  const entry: Entry = { startedAtMs: nowMs, median };
  entries.set(key, entry);
  // A failed read is not cached: one upstream blip must not be replayed to every caller for five
  // minutes. The identity check keeps a slow failure from evicting a healthy successor.
  median.catch(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return median;
}

async function readMedian(
  admin: SupabaseClient,
  orgId: string,
  lookbackDays: number,
  nowMs: number,
): Promise<number | null> {
  const since = new Date(nowMs - lookbackDays * 86_400_000).toISOString();
  const prices: number[] = [];
  await eachPage<{ net_price: number | string | null; posted_price: number | string | null }>(
    (a, b) =>
      admin
        .from("fuel_prices")
        .select("posted_price, net_price")
        .eq("org_id", orgId)
        .eq("product", "diesel")
        .gte("observed_at", since)
        .range(a, b),
    (rows) => {
      for (const r of rows) prices.push(Number(r.net_price ?? r.posted_price));
    },
  );
  // The filtering of zero/NaN rows is `medianOf`'s, so the rule stays in one place (§7.2b).
  return medianOf(prices);
}

/**
 * Drop everything. For tests only — production entries age out on their own.
 *
 * Exported because the cache is module state: without it one test's board price would be served to
 * the next test's assertions, which is the kind of cross-test bleed that reads as a flake.
 */
export function __resetDieselMedianCache(): void {
  entries.clear();
}
