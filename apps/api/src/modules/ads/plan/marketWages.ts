import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { marketEvidence, oewsSeriesFor, stateFips, type AdArea, type EvidenceItem, type MarketWageFact } from "@silvicom/shared";

/**
 * The market items of a campaign's evidence pack (ADS-PLATFORM-V2-PLAN V2r, D-AD35): BLS wage figures for heavy
 * and tractor-trailer truck drivers, for the nation and for the state the ad's area is centred in. Code reads them
 * from the BLS public data API; no model touches a figure. The sentences are the shared `marketEvidence`.
 *
 * ── THE CACHE, AND WHY 30 DAYS ─────────────────────────────────────────────────────────────────────────
 * Without a key the API allows 25 requests a day from one address (BLS's own "API Features" table, v1), and OEWS
 * publishes once a year. Each series' answer is kept in `ads_market_wages` (0630) and asked again only when its
 * row is older than `FRESH_DAYS`, so planning asks BLS at most once a month per series, whichever carrier plans.
 *
 * ── A FAILED READ IS NOT A FAILED PLAN ────────────────────────────────────────────────────────────────
 * Market pay is context for choosing angles, never a fact an ad may state (D-AD1: an ad's figures come from the
 * job alone). So when BLS cannot be reached the plan is made from what the pack does hold: a row kept from an
 * earlier answer is used even past 30 days (the figure is still the latest one BLS published that we know), and
 * with no row at all the area simply has no item. The failure is logged, and the stored plan's evidence shows a
 * person exactly which items it was written from.
 *
 * ── WHICH STATE ────────────────────────────────────────────────────────────────────────────────────────
 * The state of the area's centre, by the HERE reverse geocoder the fuel planner already uses
 * (`hereReverseGeocodeState`), handed in as `stateOf` so this file holds no key. A circle of hundreds of miles
 * can cross states; the sentence says "the state this ad's area is centred in", which is what it is.
 */

export const FRESH_DAYS = 30;
export const BLS_API = "https://api.bls.gov/publicAPI/v1/timeseries/data/";
const TIMEOUT_MS = 10_000;

export interface MarketWagesDeps {
  admin: SupabaseClient;
  now: () => Date;
  /** The two-letter code of the state or province at a point, or null (`hereReverseGeocodeState`). */
  stateOf: (lat: number, lng: number) => Promise<string | null>;
  fetch?: typeof fetch;
}

/** What the evidence pack is handed: one call, the area in, the items out. */
export interface MarketReader {
  itemsFor(area: Pick<AdArea, "latitude" | "longitude">): Promise<EvidenceItem[]>;
}

export function blsMarketReader(deps: MarketWagesDeps): MarketReader {
  return {
    async itemsFor(area) {
      const state = await deps.stateOf(area.latitude, area.longitude).catch(() => null);
      const usState = state && stateFips(state) ? state : null;
      const ids = [
        ...Object.values(oewsSeriesFor({ kind: "nation" })!),
        ...(usState ? Object.values(oewsSeriesFor({ kind: "state", code: usState })!) : []),
      ];
      return marketEvidence(usState, await wageFacts(deps, ids));
    },
  };
}

const row = z.object({ series_id: z.string(), year: z.number().int().nullable(), value: z.union([z.number(), z.string()]).nullable(), fetched_at: z.string() });

/** The facts for `ids`: the kept rows, with any missing or older than `FRESH_DAYS` asked of BLS first. */
export async function wageFacts(deps: MarketWagesDeps, ids: readonly string[]): Promise<MarketWageFact[]> {
  const { data, error } = await deps.admin.from("ads_market_wages").select("series_id, year, value, fetched_at").in("series_id", [...ids]);
  if (error) throw new Error(`ads_market_wages: ${error.message}`);
  const kept = new Map(z.array(row).parse(data ?? []).map((r) => [r.series_id, r]));
  const stale = deps.now().getTime() - FRESH_DAYS * 86_400_000;
  const ask = ids.filter((id) => { const r = kept.get(id); return !r || Date.parse(r.fetched_at) < stale; });

  if (ask.length > 0) {
    const answered = await askBls(deps, ask);
    if (answered.ok) {
      const fetched_at = deps.now().toISOString();
      // A series with no figure is kept with neither a year nor a value (0630's check holds the two together).
      const rows = answered.facts.map((f) => ({ series_id: f.series_id, year: f.value === null ? null : f.year, value: f.value, fetched_at }));
      const { error: writeError } = await deps.admin.from("ads_market_wages").upsert(rows, { onConflict: "series_id" });
      if (writeError) throw new Error(`ads_market_wages: ${writeError.message}`);
      for (const r of rows) kept.set(r.series_id, r);
    } else {
      console.error(`[ads-market] BLS wage read failed — ${answered.error}; planning with ${kept.size} kept series of ${ids.length}`);
    }
  }
  return ids.flatMap((id) => {
    const r = kept.get(id);
    if (!r) return [];
    return [{ series_id: id, year: r.year ?? 0, value: r.value === null ? null : Number(r.value) }];
  });
}

const blsAnswer = z.object({
  status: z.string(),
  message: z.array(z.string()).optional(),
  Results: z.object({
    series: z.array(z.object({
      seriesID: z.string(),
      data: z.array(z.object({ year: z.string(), period: z.string(), value: z.string() })),
    })),
  }).optional(),
});

type BlsOutcome = { ok: true; facts: MarketWageFact[] } | { ok: false; error: string };

/**
 * One request for every series asked (the v1 limit is 25 a request; the most asked is eight). Each series answers
 * its latest annual value (`A01`); a series answered with no data is kept as no value, so it is not asked again
 * every planning. A series missing from the answer altogether is not kept, and is asked next time.
 */
export async function askBls(deps: Pick<MarketWagesDeps, "fetch">, ids: readonly string[]): Promise<BlsOutcome> {
  let body: unknown;
  try {
    const res = await (deps.fetch ?? fetch)(BLS_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seriesid: ids }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    body = await res.json();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const parsed = blsAnswer.safeParse(body);
  if (!parsed.success) return { ok: false, error: "the answer was not in the API's shape" };
  // The API answers HTTP 200 with REQUEST_NOT_PROCESSED when the day's requests are spent.
  if (parsed.data.status !== "REQUEST_SUCCEEDED" || !parsed.data.Results) return { ok: false, error: `${parsed.data.status}: ${(parsed.data.message ?? []).join("; ")}` };
  const asked = new Set(ids);
  const facts: MarketWageFact[] = [];
  for (const s of parsed.data.Results.series) {
    if (!asked.has(s.seriesID)) continue;
    const annual = s.data.filter((d) => d.period === "A01" && /^\d{4}$/.test(d.year) && Number.isFinite(Number(d.value)) && Number(d.value) > 0);
    const latest = annual.sort((a, b) => Number(b.year) - Number(a.year))[0];
    facts.push(latest ? { series_id: s.seriesID, year: Number(latest.year), value: Number(latest.value) } : { series_id: s.seriesID, year: 0, value: null });
  }
  return { ok: true, facts };
}
