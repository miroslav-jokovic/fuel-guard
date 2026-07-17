/**
 * Writes parsed POSTED retail prices (Pilot public page/download — global facts, org-agnostic) into
 * `fuel_prices_posted`. Stations are resolved by store number across the whole Pilot family (same rule
 * as the locations ingest). Idempotent per (source, observed_at): a re-run replaces that batch instead
 * of duplicating it. Rows whose store # has no registry station are counted, never silently dropped —
 * a nonzero `unmatched` after a locations load means the registry is stale.
 *
 * Reliability gates live in the CALLERS (fetcher/upload route): row-count completeness floor and price
 * sanity are checked BEFORE this writer runs, so a partial page can never half-replace a good batch.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PILOT_FAMILY_BRANDS, type PostedPriceRow } from "@fuelguard/shared";

export interface PostedIngestResult {
  ok: boolean;
  error?: string;
  stationRows: number;
  pricesInserted: number;
  /** Price rows whose store # is not in the registry (load/refresh the locations export). */
  unmatched: number;
  /** Rows skipped by the parser (defects) — passed through for the caller's report. */
  skipped: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function ingestPostedPrices(
  admin: SupabaseClient,
  rows: PostedPriceRow[],
  meta: { source: string; observedAt: string; stationRows: number; skipped: number },
): Promise<PostedIngestResult> {
  const base: PostedIngestResult = { ok: false, stationRows: meta.stationRows, pricesInserted: 0, unmatched: 0, skipped: meta.skipped };
  if (rows.length === 0) return { ...base, error: "No price rows to ingest." };

  // Resolve station ids by store number, family-wide.
  const stationIdByStore = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fuel_stations").select("id, store_number")
      .in("brand", PILOT_FAMILY_BRANDS)
      .range(from, from + PAGE - 1);
    if (error) return { ...base, error: `Registry read failed: ${error.message}` };
    for (const r of (data ?? []) as Array<{ id: string; store_number: string | null }>) {
      if (r.store_number != null) stationIdByStore.set(String(r.store_number), r.id);
    }
    if (!data || data.length < PAGE) break;
  }

  let unmatched = 0;
  const inserts: Record<string, unknown>[] = [];
  for (const r of rows) {
    const stationId = stationIdByStore.get(r.storeNumber);
    if (!stationId) {
      unmatched++;
      continue;
    }
    inserts.push({
      station_id: stationId, product: r.product, price: r.price, currency: r.currency,
      unit: r.unit, bio_blend: r.bioBlend, source: meta.source, observed_at: meta.observedAt,
    });
  }

  // Replace the source's prior prices ENTIRELY — a fresh upload/fetch supersedes the old snapshot, so old
  // and new prices never coexist (posted prices are a current snapshot; only the latest per station matters).
  const del = await admin.from("fuel_prices_posted").delete().eq("source", meta.source);
  if (del.error) return { ...base, error: `Posted-price replace failed: ${del.error.message}`, unmatched };
  let pricesInserted = 0;
  for (const part of chunk(inserts, 500)) {
    const { error } = await admin.from("fuel_prices_posted").insert(part);
    if (error) return { ...base, error: `Posted-price insert failed: ${error.message}`, unmatched, pricesInserted };
    pricesInserted += part.length;
  }

  return { ...base, ok: true, pricesInserted, unmatched };
}
