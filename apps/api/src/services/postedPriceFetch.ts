/**
 * Automated fetch of Pilot's PUBLIC posted prices (pilotcompany.com/fuel-prices — the server-rendered,
 * network-wide table) into the global `fuel_prices_posted` layer. This is the freshness backbone for
 * every corridor station between the tenant's own daily price files.
 *
 * Reliability gates — ALL must pass before a single row is written (a bad fetch must be loud, never a
 * silently thinner price layer):
 *   1. Parse gate: the data table must be found (markup change → hard failure).
 *   2. Completeness gate: station rows ≥ MIN_STATION_ROWS (the full network is ~875; a hydrated/partial
 *      or paginated variant would carry ~25 and must be rejected outright).
 *   3. Sanity gate: the median USD/gal diesel price must sit in a physically plausible band — catches
 *      column-order changes (parsing DEF or unleaded as diesel) that row counts can't.
 *
 * The scheduler (started from index.ts) mirrors the EFS-ingest pattern: interval + in-flight guard,
 * disabled by env, failures logged and counted, never crashing the process.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePilotPricesPageHtml, median } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { ingestPostedPrices, type PostedIngestResult } from "./postedPriceIngest.js";
import { runRoadRangerFetch } from "./roadRangerIngest.js";

export const POSTED_SOURCE_PAGE = "pilot_public_page";
export const POSTED_SOURCE_XLSX = "pilot_public_xlsx";

/** The full network is ~875 sites; anything materially below is a partial/changed page — reject. */
const MIN_STATION_ROWS = 700;
/** Physically plausible band for a MEDIAN US truck-diesel price ($/gal). */
const DIESEL_MEDIAN_BAND = { min: 2.0, max: 9.0 };
const FETCH_TIMEOUT_MS = 30_000;
/** Identify ourselves honestly — a fleet tool refreshing a public price table at a modest cadence. */
const USER_AGENT = "FuelGuard/1.0 (fleet fuel planning; posted-price refresh)";

export interface PostedFetchResult extends PostedIngestResult {
  fetchedBytes: number;
}

/** Gate a parsed batch (shared by the automated page fetch and the manual .xlsx upload). */
export function gatePostedBatch(stationRows: number, dieselUsd: number[], minRows: number): string | null {
  if (stationRows < minRows) {
    return `Completeness gate: ${stationRows} station rows < required ${minRows} — refusing a partial batch.`;
  }
  const med = median(dieselUsd);
  if (med == null || med < DIESEL_MEDIAN_BAND.min || med > DIESEL_MEDIAN_BAND.max) {
    return `Sanity gate: median USD diesel ${med ?? "n/a"} outside ${DIESEL_MEDIAN_BAND.min}–${DIESEL_MEDIAN_BAND.max} $/gal — refusing (column drift?).`;
  }
  return null;
}

export async function runPostedPriceFetch(admin: SupabaseClient, env: Env): Promise<PostedFetchResult> {
  const fail = (error: string, fetchedBytes = 0): PostedFetchResult => ({
    ok: false, error, stationRows: 0, pricesInserted: 0, unmatched: 0, skipped: 0, fetchedBytes,
  });

  let html: string;
  try {
    const res = await fetch(env.PILOT_POSTED_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return fail(`Fetch failed: HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return fail(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const parsed = parsePilotPricesPageHtml(html);
  if (!parsed.headerFound) return fail("Parse gate: fuel-price table not found in the page (markup changed?).", html.length);

  const dieselUsd = parsed.rows.filter((r) => r.product === "diesel" && r.currency === "USD").map((r) => r.price);
  const gateError = gatePostedBatch(parsed.stationRows, dieselUsd, MIN_STATION_ROWS);
  if (gateError) return fail(gateError, html.length);

  const result = await ingestPostedPrices(admin, parsed.rows, {
    source: POSTED_SOURCE_PAGE,
    observedAt: new Date().toISOString(),
    stationRows: parsed.stationRows,
    skipped: parsed.skipped,
  });
  return { ...result, fetchedBytes: html.length };
}

/** Start the periodic posted-price fetch. Returns a stop() for tests/shutdown. */
export function startPostedPriceScheduler(env: Env): () => void {
  if (!env.PILOT_POSTED_FETCH_HOURS || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[posted-prices] scheduler disabled (PILOT_POSTED_FETCH_HOURS=0 or Supabase unset)");
    return () => {};
  }
  const intervalMs = env.PILOT_POSTED_FETCH_HOURS * 3_600_000;
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return; // a slow pass never overlaps the next tick
    inFlight = true;
    try {
      const admin = getSupabaseAdmin(env);
      const r = await runPostedPriceFetch(admin, env);
      if (r.ok) {
        console.log(`[posted-prices] pilot: ${r.pricesInserted} prices from ${r.stationRows} stations` + (r.unmatched ? ` (${r.unmatched} unmatched — locations export stale?)` : ""));
      } else {
        console.error(`[posted-prices] pilot FAILED: ${r.error}`);
      }
      // Each source fails independently — one bad page never blocks the others' refresh.
      const rr = await runRoadRangerFetch(admin, env);
      if (rr.ok) {
        console.log(`[posted-prices] road-ranger: ${rr.pricesInserted} cash prices, ${rr.stationsUpserted} stations` + (rr.geocodeFailed ? ` (${rr.geocodeFailed} still geocoding — retried next tick)` : ""));
      } else {
        console.error(`[posted-prices] road-ranger FAILED: ${rr.error}`);
      }
    } catch (e) {
      console.error("[posted-prices] FAILED:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };

  // First run shortly after boot (let the app settle), then on cadence.
  const boot = setTimeout(tick, 30_000);
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  console.log(`[posted-prices] scheduler on: every ${env.PILOT_POSTED_FETCH_HOURS}h from ${env.PILOT_POSTED_URL}`);
  return () => {
    clearTimeout(boot);
    clearInterval(timer);
  };
}
