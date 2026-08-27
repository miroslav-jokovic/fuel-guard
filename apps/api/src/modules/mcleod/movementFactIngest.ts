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
 * ⚠ Same void-lag caveat as settlements: the sweep excludes `status = 'V'` at extraction, so a
 * movement voided AFTER a sweep keeps its last-swept row until the dedicated void sweep lands
 * (named follow-up in the program plan).
 */

const CHUNK = 500;

export interface MovementFactIngestResult {
  received: number;
  upserted: number;
}

export async function ingestMovementFacts(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsMovementFactsPayload,
): Promise<MovementFactIngestResult> {
  let upserted = 0;
  for (let i = 0; i < payload.movements.length; i += CHUNK) {
    const rows = payload.movements.slice(i, i + CHUNK).map((m) => ({
      org_id: orgId,
      external_id: m.external_id,
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
