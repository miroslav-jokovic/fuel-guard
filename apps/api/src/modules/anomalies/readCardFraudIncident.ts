import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardFraudIncidentDetail } from "@silvicom/shared";

/**
 * One card-fraud incident for the queue's drawer (chunk 8c3). `card_fraud_incidents` is deny-all to the
 * browser (0438), so the drawer reads through here; every query carries the org, because the service role
 * bypasses RLS. The card number is cut to its last four HERE, so the full number never leaves the API.
 */
export async function readCardFraudIncident(
  admin: SupabaseClient,
  orgId: string,
  id: string,
): Promise<CardFraudIncidentDetail | null> {
  const { data } = await admin
    .from("card_fraud_incidents")
    .select(
      "id, status, version, disposition, resolution_note, card_ref, vehicle_id, opened_at, last_attempt_at, level, " +
        "attempt_count, fuel_taken, failed_prompts, places, last_truck",
    )
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  const r = data as Record<string, unknown> | null;
  if (!r) return null;

  const [attempts, vehicle] = await Promise.all([
    admin
      .from("card_fraud_incident_attempts")
      .select("source, attempted_at, step")
      .eq("org_id", orgId)
      .eq("incident_id", id)
      .order("attempted_at", { ascending: true }),
    r.vehicle_id
      ? admin.from("vehicles").select("unit_number").eq("id", r.vehicle_id as string).eq("org_id", orgId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    id: r.id as string,
    status: r.status as CardFraudIncidentDetail["status"],
    version: r.version as number,
    disposition: (r.disposition as CardFraudIncidentDetail["disposition"]) ?? null,
    resolutionNote: (r.resolution_note as string | null) ?? null,
    cardLast4: String(r.card_ref ?? "").replace(/\D/g, "").slice(-4) || "????",
    unitNumber: ((vehicle.data as { unit_number?: string } | null)?.unit_number) ?? null,
    openedAt: r.opened_at as string,
    lastAttemptAt: r.last_attempt_at as string,
    level: r.level as CardFraudIncidentDetail["level"],
    attemptCount: r.attempt_count as number,
    fuelTaken: r.fuel_taken === true,
    failedPrompts: (r.failed_prompts as CardFraudIncidentDetail["failedPrompts"]) ?? [],
    places: (r.places as CardFraudIncidentDetail["places"]) ?? [],
    lastTruck: (r.last_truck as CardFraudIncidentDetail["lastTruck"]) ?? null,
    attempts: ((attempts.data ?? []) as Array<{ source: "decline" | "fill"; attempted_at: string; step: CardFraudIncidentDetail["attempts"][number]["step"] }>)
      .map((a) => ({ source: a.source, attemptedAt: a.attempted_at, step: a.step ?? null })),
  };
}
