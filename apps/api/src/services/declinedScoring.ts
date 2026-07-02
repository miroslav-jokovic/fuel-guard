import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assessDecline,
  declineSignalWeight,
  isRestrictedDeclineReason,
  type DeclineSignal,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { reconcileWithSamsara } from "./samsaraRecon.js";

const WINDOW_H = 3; // hours around a decline for repeat / approval-elsewhere checks

interface DeclineRow {
  id: string;
  org_id: string;
  vehicle_id: string | null;
  declined_at: string;
  card_ref: string | null;
  city: string | null;
  state: string | null;
  location_text: string | null;
  error_code: string | null;
  error_description: string | null;
}

const DECLINE_COLS =
  "id, org_id, vehicle_id, declined_at, card_ref, city, state, location_text, error_code, error_description";

/** Score one declined attempt: correlate Samsara location + repeat / approved-elsewhere patterns. */
export async function scoreDeclinedAttempt(admin: SupabaseClient, env: Env, orgId: string, declineId: string): Promise<void> {
  const { data: row } = await admin.from("declined_transactions").select(DECLINE_COLS).eq("id", declineId).eq("org_id", orgId).single();
  if (!row) return;
  const d = row as DeclineRow;

  const reasons: DeclineSignal[] = [];
  let samsaraLocationMatched: boolean | null = null;
  let samsaraLocationConfidence: string | null = null;
  let stationLat: number | null = null;
  let stationLng: number | null = null;

  // 1) Location: was the truck actually at the decline's location? (live Samsara reconciliation)
  if (d.vehicle_id) {
    const { data: veh } = await admin.from("vehicles").select("samsara_vehicle_id").eq("id", d.vehicle_id).maybeSingle();
    const samsaraVehicleId = veh?.samsara_vehicle_id ?? null;
    if (samsaraVehicleId) {
      const recon = await reconcileWithSamsara(admin, env, orgId, {
        vehicleId: d.vehicle_id,
        samsaraVehicleId,
        fueledAt: d.declined_at,
        city: d.city,
        state: d.state,
        locationName: d.location_text,
        preciseTime: true, // declined_at carries a real timestamp
        gallons: null,
        tankCapacityGal: null,
      }).catch(() => null);
      if (recon) {
        samsaraLocationMatched = recon.locationMatched;
        samsaraLocationConfidence = recon.locationConfidence;
        stationLat = recon.stationLat;
        stationLng = recon.stationLng;
        if (recon.locationMatched === false) {
          reasons.push({
            key: "location_mismatch",
            weight: declineSignalWeight("location_mismatch"),
            detail: `Samsara shows the truck was not at ${d.city ?? "the decline location"}, ${d.state ?? ""} when the card was declined.`,
          });
        }
      }
    }
  }

  const t = new Date(d.declined_at).getTime();
  const winStart = new Date(t - WINDOW_H * 3_600_000).toISOString();
  const winEnd = new Date(t + WINDOW_H * 3_600_000).toISOString();

  // 2) Repeated declines on the same card in the window (card testing).
  if (d.card_ref) {
    const { count } = await admin
      .from("declined_transactions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("card_ref", d.card_ref)
      .gte("declined_at", winStart)
      .lte("declined_at", winEnd);
    if ((count ?? 0) >= 3) {
      reasons.push({
        key: "repeated_declines",
        weight: declineSignalWeight("repeated_declines"),
        detail: `This card was declined ${count} times within ${WINDOW_H * 2}h.`,
      });
    }
  }

  // 3) Declined here, then APPROVED on the same card at a different place soon after.
  if (d.card_ref) {
    const { data: approvals } = await admin
      .from("fuel_transactions")
      .select("city, state, location_text, fueled_at")
      .eq("org_id", orgId)
      .eq("card_ref", d.card_ref)
      .gte("fueled_at", d.declined_at)
      .lte("fueled_at", winEnd);
    const elsewhere = (approvals ?? []).find(
      (a) => (a.city ?? "").toLowerCase() !== (d.city ?? "").toLowerCase() || (a.state ?? "").toLowerCase() !== (d.state ?? "").toLowerCase(),
    );
    if (elsewhere) {
      reasons.push({
        key: "approved_elsewhere",
        weight: declineSignalWeight("approved_elsewhere"),
        detail: `Declined here, then approved at ${elsewhere.city ?? elsewhere.location_text ?? "another location"}, ${elsewhere.state ?? ""} shortly after.`,
      });
    }
  }

  // 4) Restricted decline reason (weak corroborator).
  if (isRestrictedDeclineReason(d.error_code, d.error_description)) {
    reasons.push({
      key: "restricted_reason",
      weight: declineSignalWeight("restricted_reason"),
      detail: `Decline reason indicates a restriction: ${d.error_description ?? d.error_code}.`,
    });
  }

  const assessment = assessDecline(reasons);
  await admin
    .from("declined_transactions")
    .update({
      suspicion_level: assessment.level,
      suspicion_reasons: assessment.reasons,
      samsara_location_matched: samsaraLocationMatched,
      samsara_location_confidence: samsaraLocationConfidence,
      station_lat: stationLat,
      station_lng: stationLng,
      scored_at: new Date().toISOString(),
    })
    .eq("id", declineId);
}

/** Score every declined attempt for an org (newest first). Returns the count scored. */
export async function scoreDeclinedOrg(admin: SupabaseClient, env: Env, orgId: string): Promise<number> {
  const { data: rows } = await admin
    .from("declined_transactions")
    .select("id")
    .eq("org_id", orgId)
    .order("declined_at", { ascending: false });
  const ids = ((rows ?? []) as { id: string }[]).map((x) => x.id);
  for (const id of ids) await scoreDeclinedAttempt(admin, env, orgId, id);
  return ids.length;
}

/** Score the declined attempts from one import (post reject-report upload). */
export async function scoreDeclinedImport(admin: SupabaseClient, env: Env, orgId: string, importId: string): Promise<number> {
  const { data: rows } = await admin
    .from("declined_transactions")
    .select("id")
    .eq("org_id", orgId)
    .eq("import_id", importId);
  const ids = ((rows ?? []) as { id: string }[]).map((x) => x.id);
  for (const id of ids) await scoreDeclinedAttempt(admin, env, orgId, id);
  return ids.length;
}
