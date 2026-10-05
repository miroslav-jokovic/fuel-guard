import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsFuelTaxReceiptsPayload } from "@silvicom/shared";

/**
 * McLeod's hand-keyed fuel receipts (`fuel_tax_history.source = 'F'`) — the landing and the one read
 * (IFTA-PRECISION-PLAN IP6, 0434).
 *
 * Its own file rather than a sixth function in `financialIngest.ts`: those are the money subledgers
 * that feed the fleet report, and this is a fuel-TAX fact read only by the ifta module, through
 * `readFuelTaxReceipts` below (D-SEP1 — nothing outside the collector touches its staging).
 */

const CHUNK = 500;

/**
 * Upsert on (org_id, external_id), full row — McLeod is the source of truth for its own staging
 * table, so a re-swept receipt REPLACES the stored one, a voided one flips to void, and the nightly
 * two-year re-read converges rather than duplicating. Every NOT NULL column is in the payload, which
 * is what makes this a legitimate upsert under `lint:upserts`.
 */
export async function ingestFuelTaxReceipts(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsFuelTaxReceiptsPayload,
): Promise<{ received: number; upserted: number }> {
  let upserted = 0;
  for (let i = 0; i < payload.receipts.length; i += CHUNK) {
    const rows = payload.receipts.slice(i, i + CHUNK).map((r) => ({
      org_id: orgId,
      external_id: r.external_id,
      company_id: r.company_id ?? null,
      tractor_unit: r.tractor_unit,
      jurisdiction: r.jurisdiction,
      receipt_date: r.receipt_date,
      gallons: r.gallons,
      processed_at: r.processed_at ?? null,
      is_void: r.is_void,
    }));
    const { data, error } = await admin
      .from("mcleod_fuel_tax_receipts")
      .upsert(rows, { onConflict: "org_id,external_id" })
      .select("id");
    if (error) throw new Error(`mcleod_fuel_tax_receipts upsert failed: ${error.message}`);
    upserted += data?.length ?? rows.length;
  }
  return { received: payload.receipts.length, upserted };
}

/** One hand-keyed receipt as the ifta module reads it. Voided receipts are never returned. */
export interface FuelTaxReceipt {
  externalId: string;
  tractorUnit: string;
  jurisdiction: string;
  receiptDate: string;
  gallons: number;
  processedAt: string | null;
}

/**
 * Live receipts dated in [fromDay, toDayExclusive), optionally for one jurisdiction. Paged by primary
 * key — PostgREST caps a response at 1,000 rows, and a year of receipts is ~300.
 */
export async function readFuelTaxReceipts(
  admin: SupabaseClient,
  orgId: string,
  fromDay: string,
  toDayExclusive: string,
  jurisdiction?: string,
): Promise<FuelTaxReceipt[]> {
  const out: FuelTaxReceipt[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = admin
      .from("mcleod_fuel_tax_receipts")
      .select("external_id, tractor_unit, jurisdiction, receipt_date, gallons, processed_at")
      .eq("org_id", orgId)
      .eq("is_void", false)
      .gte("receipt_date", fromDay)
      .lt("receipt_date", toDayExclusive);
    if (jurisdiction) q = q.eq("jurisdiction", jurisdiction);
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`mcleod_fuel_tax_receipts read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{
      external_id: string; tractor_unit: string; jurisdiction: string;
      receipt_date: string; gallons: number | string; processed_at: string | null;
    }>;
    for (const r of rows) {
      out.push({
        externalId: r.external_id,
        tractorUnit: r.tractor_unit,
        jurisdiction: r.jurisdiction,
        receiptDate: r.receipt_date,
        gallons: Number(r.gallons),
        processedAt: r.processed_at,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}
