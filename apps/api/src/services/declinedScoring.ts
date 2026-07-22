import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assessDecline,
  declineSignalWeight,
  isRestrictedDeclineReason,
  isNoonSentinelIso,
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

/** A successful fill considered as the "corrective" purchase right after a decline (wrong-unit recovery). */
interface CorrectiveFill {
  vehicle_id: string | null;
  card_ref: string | null;
  city: string | null;
  state: string | null;
  location_text: string | null;
  fueled_at: string;
}

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
  let locationMismatched = false;

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
        // A decline normally carries a real timestamp — but a date-only reject row is anchored at the
        // noon sentinel, and treating THAT as precise could raise a false mismatch. Detect it.
        preciseTime: !isNoonSentinelIso(d.declined_at),
        gallons: null,
        tankCapacityGal: null,
      }).catch(() => null);
      if (recon) {
        samsaraLocationMatched = recon.locationMatched;
        samsaraLocationConfidence = recon.locationConfidence;
        stationLat = recon.stationLat;
        stationLng = recon.stationLng;
        if (recon.locationMatched === false) locationMismatched = true;
      }
    }
  }

  const t = new Date(d.declined_at).getTime();
  const winStart = new Date(t - WINDOW_H * 3_600_000).toISOString();
  const winEnd = new Date(t + WINDOW_H * 3_600_000).toISOString();

  // Wrong-truck-number check + corrective-fill confirmation. The typed truck wasn't at the station — so look
  // for a SUCCESSFUL fill at that same station in the window right after the decline: a mis-typed unit gets
  // blocked (no fuel dispensed), then the driver completes the purchase on the correct unit moments later.
  // A same-CARD success is the strongest match (same driver + pump); a different truck at the same city/state
  // is the fallback. Either way it proves the decline was benign AND names the REAL truck, so the case reads
  // "entered 632, real truck 633" instead of a vague location alert. Mirrors the manual audit: find who
  // actually fueled at that place/time and confirm the entered truck was elsewhere.
  let corrective: CorrectiveFill | null = null;
  if (locationMismatched && (d.city || d.state)) {
    const { data: fills } = await admin
      .from("fuel_transactions")
      .select("vehicle_id, card_ref, city, state, location_text, fueled_at")
      .eq("org_id", orgId)
      .gte("fueled_at", d.declined_at)
      .lte("fueled_at", winEnd)
      .order("fueled_at", { ascending: true });
    const list = (fills ?? []) as CorrectiveFill[];
    const sameSite = (x: CorrectiveFill) =>
      (x.city ?? "").toLowerCase() === (d.city ?? "").toLowerCase() &&
      (x.state ?? "").toLowerCase() === (d.state ?? "").toLowerCase();
    // Prefer the same card at the same site; otherwise a different truck at the same site.
    corrective =
      (d.card_ref ? list.find((x) => sameSite(x) && x.card_ref === d.card_ref) : undefined) ??
      list.find((x) => sameSite(x) && x.vehicle_id != null && x.vehicle_id !== d.vehicle_id) ??
      null;
  }

  if (locationMismatched && corrective) {
    // Name the real truck (unit number) that actually fueled, so the reviewer doesn't have to look it up.
    let realUnit: string | null = null;
    if (corrective.vehicle_id) {
      const { data: realVeh } = await admin
        .from("vehicles").select("unit_number").eq("id", corrective.vehicle_id).eq("org_id", orgId).maybeSingle();
      realUnit = (realVeh as { unit_number?: string } | null)?.unit_number ?? null;
    }
    const minsAfter = Math.max(0, Math.round((new Date(corrective.fueled_at).getTime() - t) / 60_000));
    const site = corrective.location_text ?? ([d.city, d.state].filter(Boolean).join(", ") || "the same station");
    const who = realUnit
      ? `truck ${realUnit}`
      : d.card_ref && corrective.card_ref === d.card_ref
        ? "the same card"
        : "a different truck";
    reasons.push({
      key: "wrong_unit_number",
      weight: declineSignalWeight("wrong_unit_number"),
      detail: `Benign mis-typed unit number — ${who} fueled successfully at ${site} ${minsAfter} min after this decline, while Samsara shows the entered truck wasn't there. EFS blocked the wrong-unit entry (no fuel dispensed) and the driver completed the purchase on the correct unit.`,
    });
  } else if (locationMismatched) {
    reasons.push({
      key: "location_mismatch",
      weight: declineSignalWeight("location_mismatch"),
      detail: `Samsara shows the truck was not at ${d.city ?? "the decline location"}, ${d.state ?? ""} when the card was declined, and no successful fill at that station followed — treat as a possible wrong-card / location attempt.`,
    });
  }

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
