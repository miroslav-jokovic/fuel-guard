import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsMovementFactsPayload } from "@silvicom/shared";

/**
 * Movement-facts staging ingest — the cents-per-mile denominator lands (0267).
 *
 * This is the C2 posting step that movements.mjs deliberately withheld: C1 proved the extraction
 * against the carrier's own operations report, the fuel and settlement reconciliations gave the
 * totals something to be checked against, and only then does a byte of it get stored. Same
 * idempotency contract as the 0257 family: full-row upsert on (org_id, external_id), so the agent's
 * overlapping rolling windows converge instead of duplicating.
 *
 * Stops are stored as the payload's own ordered JSONB array — the deadhead chain
 * (`inferDeadheadLegs`) is the only consumer and reads them whole; see 0267's header for why a
 * second table was rejected.
 *
 * Voids arrive WITH their status since D-FIN5 (`external_status = 'V'`), so a movement voided after
 * a sweep flips on the next one; the reader excludes V.
 */

const CHUNK = 500;

export interface MovementFactIngestResult {
  received: number;
  upserted: number;
}

/**
 * `movement.id` REPEATS across McLeod companies (measured 2026-09-03: 296,242 rows, 277,481 distinct
 * ids, 18,761 shared between TMS/TMS2/TMS3), and this table is still keyed (org_id, external_id).
 * Until the company-aware key ships (F8c, FINANCE-GO-LIVE-PLAN §1.8), a sweep of a second company
 * would silently OVERWRITE the first company's trips. So the ingest refuses it: a chunk that would
 * replace a stored row carrying a different company fails whole, naming the ids, and nothing is
 * written. A stored row with no company yet (written before 0303) is not a conflict.
 */
async function refuseCrossCompanyOverwrite(
  admin: SupabaseClient,
  orgId: string,
  chunk: TmsMovementFactsPayload["movements"],
): Promise<void> {
  const incoming = new Map(chunk.map((m) => [m.external_id, m.company_id]));
  const { data, error } = await admin
    .from("mcleod_movements")
    .select("external_id, company_id")
    .eq("org_id", orgId)
    .in("external_id", [...incoming.keys()]);
  if (error) throw new Error(`mcleod_movements company check failed: ${error.message}`);
  const clashes = ((data ?? []) as { external_id: string; company_id: string | null }[]).filter(
    (r) => r.company_id != null && r.company_id !== incoming.get(r.external_id),
  );
  if (clashes.length) {
    const named = clashes.slice(0, 5).map((c) => `${c.external_id}:${c.company_id}`).join(", ");
    throw new Error(
      `mcleod_movements: ${clashes.length} movement id(s) already belong to another McLeod company (${named}) — ` +
        `movement ids repeat across companies and the per-company key is F8c; refusing to overwrite`,
    );
  }
}

export async function ingestMovementFacts(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsMovementFactsPayload,
): Promise<MovementFactIngestResult> {
  let upserted = 0;
  for (let i = 0; i < payload.movements.length; i += CHUNK) {
    const chunk = payload.movements.slice(i, i + CHUNK);
    await refuseCrossCompanyOverwrite(admin, orgId, chunk);
    const rows = chunk.map((m) => ({
      org_id: orgId,
      external_id: m.external_id,
      company_id: m.company_id,
      tractor_unit: m.tractor_unit ?? null,
      trailer_unit: m.trailer_unit ?? null,
      driver_external_ids: m.driver_external_ids,
      order_ids: m.order_ids,
      loaded_miles: m.loaded_miles ?? null,
      fuel_miles: m.fuel_miles ?? null,
      distance_unit: m.distance_unit,
      external_status: m.external_status ?? null,
      movement_type: m.movement_type ?? null,
      settled_at: m.settled_at ?? null,
      stops: m.stops,
    }));
    const { data, error } = await admin
      .from("mcleod_movements")
      .upsert(rows, { onConflict: "org_id,external_id" })
      .select("id");
    if (error) throw new Error(`mcleod_movements upsert failed: ${error.message}`);
    upserted += data?.length ?? rows.length;
  }
  return { received: payload.movements.length, upserted };
}
