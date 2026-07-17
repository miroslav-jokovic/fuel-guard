/**
 * Love's "Store & Fuel Prices" Experience API adapter (live prices). OAuth2 client-credentials (Auth0):
 * POST client_id/secret to the token URL -> Bearer token -> GET /locations (registry) + GET /fuelPrices
 * (posted diesel/DEF). DISABLED until Love's grants credentials: runLovesApiSync returns a clear
 * "not configured" result when any of base URL / token URL / client id / secret / diesel product codes is
 * unset, so it never fails a scheduler tick before onboarding.
 *
 * Response mapping follows the published OpenAPI (loves-store-fuel-price-exp-api 1.0.11): /locations items
 * carry number/latitude/longitude/state/city/exit/addresses[]; /fuelPrices items carry storeNumber +
 * fuelPrices[]{price,name,category}. Structure-correct but UNVERIFIED against the live API — the first real
 * run after credentials land is the acceptance test; nothing is written unless the pull looks complete.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LovesLocationRow } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { upsertLoves } from "./lovesIngest.js";

export const LOVES_API_SOURCE = "loves_api";
const FETCH_TIMEOUT_MS = 30_000;
const MIN_LOCATIONS = 400;

export interface LovesApiResult {
  ok: boolean;
  error?: string;
  stationsUpserted: number;
  pricesInserted: number;
  skipped: number;
}

/** True only when every credential + the diesel product codes are configured. */
export function lovesApiConfigured(env: Env): boolean {
  return Boolean(
    env.LOVES_API_BASE_URL && env.LOVES_TOKEN_URL && env.LOVES_CLIENT_ID && env.LOVES_CLIENT_SECRET && env.LOVES_DIESEL_PRODUCT_CODES,
  );
}

async function getToken(env: Env): Promise<string> {
  const res = await fetch(env.LOVES_TOKEN_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.LOVES_CLIENT_ID!, client_secret: env.LOVES_CLIENT_SECRET! }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("no access_token in token response");
  return j.access_token;
}

async function getJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

interface ApiLoc {
  number?: number | string; latitude?: number; longitude?: number; state?: string; city?: string;
  exit?: string; highway?: string; addresses?: Array<{ address1?: string; zip?: string }>;
}
interface ApiPriceItem {
  storeNumber?: number | string;
  fuelPrices?: Array<{ price?: number; name?: string; category?: string; type?: string }>;
}

export async function runLovesApiSync(admin: SupabaseClient, env: Env): Promise<LovesApiResult> {
  const fail = (error: string): LovesApiResult => ({ ok: false, error, stationsUpserted: 0, pricesInserted: 0, skipped: 0 });
  if (!lovesApiConfigured(env)) {
    return fail("Love's API not configured — set LOVES_API_BASE_URL, LOVES_TOKEN_URL, LOVES_CLIENT_ID, LOVES_CLIENT_SECRET and LOVES_DIESEL_PRODUCT_CODES once Love's grants access.");
  }
  const base = env.LOVES_API_BASE_URL!.replace(/\/+$/, "");
  let token: string;
  try {
    token = await getToken(env);
  } catch (e) {
    return fail(`OAuth token failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  let locs: ApiLoc[];
  let prices: ApiPriceItem[];
  try {
    locs = (await getJson(`${base}/locations`, token)) as ApiLoc[];
    prices = (await getJson(`${base}/fuelPrices?productCodes=${encodeURIComponent(env.LOVES_DIESEL_PRODUCT_CODES)}`, token)) as ApiPriceItem[];
  } catch (e) {
    return fail(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(locs) || locs.length < MIN_LOCATIONS) {
    return fail(`Completeness gate: ${Array.isArray(locs) ? locs.length : 0} locations < ${MIN_LOCATIONS} — refusing a partial pull.`);
  }

  // Merge prices onto locations by store number (diesel vs DEF identified by label).
  const priceByStore = new Map<string, { diesel: number | null; def: number | null }>();
  for (const p of Array.isArray(prices) ? prices : []) {
    const store = String(p.storeNumber ?? "");
    if (!store) continue;
    let diesel: number | null = null;
    let def: number | null = null;
    for (const fp of p.fuelPrices ?? []) {
      if (fp.price == null) continue;
      const label = `${fp.name ?? ""} ${fp.category ?? ""} ${fp.type ?? ""}`.toLowerCase();
      if (/\bdef\b|diesel exhaust/.test(label)) def = Number(fp.price);
      else if (/diesel/.test(label)) diesel = Number(fp.price);
    }
    priceByStore.set(store, { diesel, def });
  }

  const rows: LovesLocationRow[] = [];
  for (const l of locs) {
    const store = String(l.number ?? "");
    const lat = Number(l.latitude);
    const lng = Number(l.longitude);
    if (!store || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const pr = priceByStore.get(store) ?? { diesel: null, def: null };
    rows.push({
      storeNumber: store, name: `Love's #${store}`, lat, lng,
      state: l.state ? l.state.toUpperCase() : null, city: l.city ?? null,
      address: l.addresses?.[0]?.address1 ?? null, zip: l.addresses?.[0]?.zip ?? null,
      exit: l.exit ?? l.highway ?? null, parkingSpaces: null,
      hasDiesel: pr.diesel != null, hasDef: pr.def != null, dieselPrice: pr.diesel, defPrice: pr.def,
    });
  }
  const w = await upsertLoves(admin, rows, { source: LOVES_API_SOURCE, observedAt: new Date().toISOString() });
  return { ok: w.ok, error: w.error, stationsUpserted: w.stationsUpserted, pricesInserted: w.pricesInserted, skipped: w.skipped };
}
