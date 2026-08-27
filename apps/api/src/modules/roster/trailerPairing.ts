import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one sanctioned way an inference writes a trailer's pairing. `trailers` is roster-owned
 * (D-ARC3); the samsara collector infers pairings from GPS co-location but records them HERE, so
 * the manual-pairing invariant lives with the table's owner instead of inside a caller: a pairing
 * a person set by hand is authoritative and is never overwritten by a machine — the guard is the
 * `pairing_source` filter in the WHERE, not caller discipline.
 */
export async function recordInferredTrailerPairing(
  admin: SupabaseClient,
  orgId: string,
  trailerId: string,
  match: { vehicleId: string; confidence: number },
): Promise<boolean> {
  const { data } = await admin
    .from("trailers")
    .update({ assigned_vehicle_id: match.vehicleId, pairing_source: "inferred", pairing_confidence: match.confidence })
    .eq("id", trailerId)
    .eq("org_id", orgId)
    // NULL-safe: an unpaired trailer has pairing_source NULL, and `neq` alone would drop it.
    .or("pairing_source.is.null,pairing_source.neq.manual")
    .select("id");
  return (data ?? []).length > 0;
}
