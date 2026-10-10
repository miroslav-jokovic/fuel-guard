import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The write half of DB7 (DISPATCH-BOARD-PLAN, migration 0453): the loads module's interface for "the
 * board said this truck would reach this stop at this time".
 *
 * The estimate is made by `livemap` (the board's composition and `boardEta`); the row is a fact about a
 * load's stop, so `loads` owns the table and this is the only thing that writes it. Plain INSERT, every
 * column given — an append-only measurement, nothing to merge (`lint:upserts`).
 */

export interface StopEtaPrediction {
  loadId: string;
  stopSeq: number;
  vehicleId: string;
  etaAt: string;
  miles: number;
  restAdded: boolean;
  gpsAgeSeconds: number | null;
  hosKnown: boolean;
  windowClosesAt: string | null;
  verdict: string;
}

/** ~120 rows an hour on today's fleet; one statement until the fleet is several times larger. */
const BATCH = 500;

export async function recordStopEtaPredictions(
  admin: SupabaseClient,
  orgId: string,
  predictedAt: Date,
  predictions: StopEtaPrediction[],
): Promise<number> {
  const at = predictedAt.toISOString();
  for (let i = 0; i < predictions.length; i += BATCH) {
    const rows = predictions.slice(i, i + BATCH).map((p) => ({
      org_id: orgId,
      load_id: p.loadId,
      stop_seq: p.stopSeq,
      vehicle_id: p.vehicleId,
      predicted_at: at,
      eta_at: p.etaAt,
      miles: p.miles,
      rest_added: p.restAdded,
      gps_age_seconds: p.gpsAgeSeconds,
      hos_known: p.hosKnown,
      window_closes_at: p.windowClosesAt,
      verdict: p.verdict,
    }));
    const { error } = await admin.from("load_stop_eta_predictions").insert(rows);
    if (error) throw new Error(error.message);
  }
  return predictions.length;
}
