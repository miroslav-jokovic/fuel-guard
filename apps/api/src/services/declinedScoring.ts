import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assessDecline,
  declineSignalWeight,
  classifyDeclineReason,
  assessCardAssignment,
  cardRefsMatch,
  attributeDeclinedRow,
  isNoonSentinelIso,
  CARD_MISMATCH_UNVERIFIED_WEIGHT,
  type DeclineSignal,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { reconcileWithSamsara } from "./samsaraRecon.js";
import { syncCardAssignments, lookupCardAssignment } from "./cardAssignments.js";

const WINDOW_H = 3; // hours around a decline for repeat / approval-elsewhere checks

interface DeclineRow {
  id: string;
  org_id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  driver_ext_id: string | null;
  declined_at: string;
  card_ref: string | null;
  city: string | null;
  state: string | null;
  location_text: string | null;
  error_code: string | null;
  error_description: string | null;
}

const DECLINE_COLS =
  "id, org_id, vehicle_id, driver_id, driver_ext_id, declined_at, card_ref, city, state, location_text, error_code, error_description";

/** A successful fill considered as the "corrective" purchase right after a decline (wrong-unit recovery). */
interface CorrectiveFill {
  vehicle_id: string | null;
  driver_id: string | null;
  card_ref: string | null;
  city: string | null;
  state: string | null;
  location_text: string | null;
  fueled_at: string;
}

/** Was this vehicle at the decline's location? true / false / null (no telematics / no coverage). */
async function vehicleAtDeclineLocation(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  vehicleId: string,
  d: DeclineRow,
): Promise<{ matched: boolean | null; confidence: string | null; stationLat: number | null; stationLng: number | null }> {
  const { data: veh } = await admin.from("vehicles").select("samsara_vehicle_id").eq("id", vehicleId).maybeSingle();
  const samsaraVehicleId = veh?.samsara_vehicle_id ?? null;
  if (!samsaraVehicleId) return { matched: null, confidence: null, stationLat: null, stationLng: null };
  const recon = await reconcileWithSamsara(admin, env, orgId, {
    vehicleId,
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
  if (!recon) return { matched: null, confidence: null, stationLat: null, stationLng: null };
  return { matched: recon.locationMatched, confidence: recon.locationConfidence, stationLat: recon.stationLat, stationLng: recon.stationLng };
}

/** Score one declined attempt: correlate Samsara location + card-assignment + repeat / approval patterns. */
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

  // 0) The card's ASSIGNED vehicle (fuel_cards — learned from fill history / set manually). The standard
  // EFS reject export does not carry the card-assigned truck (WP1 audit F3), so this table is the
  // card→truck ground truth the assignment check runs against (WP1 D4).
  const assignedVehicleId: string | null = await lookupCardAssignment(admin, orgId, d.card_ref);

  // 1) Location: was the PUMP-UNIT truck actually at the decline's location? (live Samsara reconciliation)
  if (d.vehicle_id) {
    const loc = await vehicleAtDeclineLocation(admin, env, orgId, d.vehicle_id, d);
    samsaraLocationMatched = loc.matched;
    samsaraLocationConfidence = loc.confidence;
    stationLat = loc.stationLat;
    stationLng = loc.stationLng;
    if (loc.matched === false) locationMismatched = true;
  }

  // 1b) Where was the card's ASSIGNED truck (when it differs from the pump unit)? Feeds the
  // stale-assignment vs unit-typo vs confirmed-misuse decision (WP1 D4).
  let assignedAtStation: boolean | null = null;
  if (assignedVehicleId && assignedVehicleId !== d.vehicle_id) {
    assignedAtStation = (await vehicleAtDeclineLocation(admin, env, orgId, assignedVehicleId, d)).matched;
  }

  const t = new Date(d.declined_at).getTime();
  const winStart = new Date(t - WINDOW_H * 3_600_000).toISOString();
  const winEnd = new Date(t + WINDOW_H * 3_600_000).toISOString();

  // The decline's driver identity, resolved via the stable EFS numeric id when possible (WP1 D5) —
  // used to match same-driver approvals even when EFS masks one report's card number (F5).
  let declineDriverId: string | null = d.driver_id;
  if (!declineDriverId && d.driver_ext_id) {
    const { data: drv } = await admin
      .from("drivers")
      .select("id")
      .eq("org_id", orgId)
      .eq("efs_driver_id", d.driver_ext_id)
      .maybeSingle();
    declineDriverId = (drv?.id as string | null) ?? null;
  }
  /** Same card (format-tolerant) or same resolved driver — the F5-safe "same actor" test. */
  const sameActor = (x: { card_ref: string | null; driver_id: string | null }): boolean =>
    cardRefsMatch(x.card_ref, d.card_ref) || (declineDriverId != null && x.driver_id === declineDriverId);

  // Wrong-truck-number check + corrective-fill confirmation. The typed truck wasn't at the station — so look
  // for a SUCCESSFUL fill at that same station in the window right after the decline: a mis-typed unit gets
  // blocked (no fuel dispensed), then the driver completes the purchase on the correct unit moments later.
  // A same-CARD/driver success is the strongest match (same actor + pump); a different truck at the same
  // city/state is the fallback. Either way it proves the decline was benign AND names the REAL truck, so the
  // case reads "entered 632, real truck 633" instead of a vague location alert. Mirrors the manual audit:
  // find who actually fueled at that place/time and confirm the entered truck was elsewhere.
  let corrective: CorrectiveFill | null = null;
  if (locationMismatched && (d.city || d.state)) {
    const { data: fills } = await admin
      .from("fuel_transactions")
      .select("vehicle_id, driver_id, card_ref, city, state, location_text, fueled_at")
      .eq("org_id", orgId)
      .gte("fueled_at", d.declined_at)
      .lte("fueled_at", winEnd)
      .order("fueled_at", { ascending: true });
    const list = (fills ?? []) as CorrectiveFill[];
    const sameSite = (x: CorrectiveFill) =>
      (x.city ?? "").toLowerCase() === (d.city ?? "").toLowerCase() &&
      (x.state ?? "").toLowerCase() === (d.state ?? "").toLowerCase();
    // Prefer the same card/driver at the same site; otherwise a different truck at the same site.
    corrective =
      list.find((x) => sameSite(x) && sameActor(x)) ??
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
      : sameActor(corrective)
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

  // 1c) Card-assignment verdict (pump unit ≠ assigned truck). Skipped when a corrective fill already
  // explained the event as a benign wrong-unit entry.
  if (!corrective) {
    const verdict = assessCardAssignment({
      assignedVehicleId,
      pumpVehicleId: d.vehicle_id,
      pumpUnitAtStation: samsaraLocationMatched,
      assignedAtStation,
    });
    if (verdict.kind !== "none") {
      const units = await unitNumbers(admin, orgId, [assignedVehicleId, d.vehicle_id]);
      const aUnit = assignedVehicleId ? (units.get(assignedVehicleId) ?? "?") : "?";
      const pUnit = d.vehicle_id ? (units.get(d.vehicle_id) ?? "?") : "?";
      if (verdict.kind === "stale_assignment") {
        reasons.push({
          key: "stale_card_assignment",
          weight: declineSignalWeight("stale_card_assignment"),
          detail: `Card is assigned to truck ${aUnit} but travels with truck ${pUnit} (which WAS at the station) — a stale card assignment, not misuse. Reassign the card to ${pUnit} to stop these declines.`,
        });
      } else if (verdict.kind === "unit_typo") {
        reasons.push({
          key: "card_unit_typo",
          weight: declineSignalWeight("card_unit_typo"),
          detail: `Card's assigned truck ${aUnit} WAS at the station; the pump unit ${pUnit} looks mis-keyed. The card is with its truck — benign entry error.`,
        });
      } else if (verdict.kind === "mismatch_confirmed") {
        reasons.push({
          key: "card_assigned_mismatch",
          weight: declineSignalWeight("card_assigned_mismatch"),
          detail: `Card assigned to truck ${aUnit} was used with pump unit ${pUnit}, and telematics places NEITHER truck at the station — the card is away from both its trucks.`,
        });
      } else {
        reasons.push({
          key: "card_assigned_mismatch",
          weight: CARD_MISMATCH_UNVERIFIED_WEIGHT,
          detail: `Card assigned to truck ${aUnit} was used with pump unit ${pUnit}; telematics could not place either truck at the station (corroborating signal only).`,
        });
      }
    }
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

  // 3) Declined here, then APPROVED (same card OR same driver — F5 format-tolerant) elsewhere soon after.
  if (d.card_ref || declineDriverId) {
    const { data: approvals } = await admin
      .from("fuel_transactions")
      .select("vehicle_id, driver_id, card_ref, city, state, location_text, fueled_at")
      .eq("org_id", orgId)
      .gte("fueled_at", d.declined_at)
      .lte("fueled_at", winEnd);
    const elsewhere = ((approvals ?? []) as CorrectiveFill[]).find(
      (a) =>
        sameActor(a) &&
        ((a.city ?? "").toLowerCase() !== (d.city ?? "").toLowerCase() ||
          (a.state ?? "").toLowerCase() !== (d.state ?? "").toLowerCase()),
    );
    if (elsewhere) {
      reasons.push({
        key: "approved_elsewhere",
        weight: declineSignalWeight("approved_elsewhere"),
        detail: `Declined here, then approved at ${elsewhere.city ?? elsewhere.location_text ?? "another location"}, ${elsewhere.state ?? ""} shortly after.`,
      });
    }
  }

  // 4) The decline REASON via the WP1 taxonomy (declineReason.ts). EFS's proximity verdict is
  // alert-grade on its own — this is the change that flips the 0851226257 class from Clear to Alert.
  // Unknown phrasings score nothing but are STORED (reason_category) so they can't hide.
  const reason = classifyDeclineReason(d.error_code, d.error_description);
  if (reason.category === "proximity_failure") {
    reasons.push({
      key: "proximity_failure",
      weight: declineSignalWeight("proximity_failure"),
      detail: `EFS's telematics geofence declined this purchase (${d.error_description ?? d.error_code}) — the merchant was too far from the card's truck at authorization. EFS already verified the card was not with its truck.`,
    });
  } else if (reason.category === "site_restriction" || reason.category === "limit") {
    reasons.push({
      key: "restricted_reason",
      weight: declineSignalWeight("restricted_reason"),
      detail: `Decline reason indicates a restriction: ${d.error_description ?? d.error_code}.`,
    });
  } else if (reason.category === "card_not_active") {
    reasons.push({
      key: "card_not_active",
      weight: declineSignalWeight("card_not_active"),
      detail: `Card was not active: ${d.error_description ?? d.error_code}.`,
    });
  }

  const assessment = assessDecline(reasons);
  await admin
    .from("declined_transactions")
    .update({
      suspicion_level: assessment.level,
      suspicion_reasons: assessment.reasons,
      reason_category: reason.category,
      samsara_location_matched: samsaraLocationMatched,
      samsara_location_confidence: samsaraLocationConfidence,
      station_lat: stationLat,
      station_lng: stationLng,
      scored_at: new Date().toISOString(),
    })
    .eq("id", declineId);
}

/** Unit numbers for a set of vehicle ids (for human-readable signal details). */
async function unitNumbers(admin: SupabaseClient, orgId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = ids.filter((x): x is string => !!x);
  if (!wanted.length) return new Map();
  const { data } = await admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).in("id", wanted);
  return new Map(((data ?? []) as { id: string; unit_number: string }[]).map((v) => [v.id, v.unit_number]));
}

/**
 * WP1 D2 backfill — (re-)attribute declines to vehicles/drivers with the shared matcher
 * (attributeDeclinedRow). Ingest now attributes new rows; this catches rows imported before the fix
 * (and unit/driver records added later). Only ever FILLS missing attribution — never overwrites an
 * existing value. Returns how many rows changed. Idempotent.
 */
export async function attributeDeclines(admin: SupabaseClient, orgId: string): Promise<number> {
  const [{ data: declines }, { data: vehicles }, { data: drivers }] = await Promise.all([
    admin
      .from("declined_transactions")
      .select("id, unit, driver_ext_id, driver_name, vehicle_id, driver_id")
      .eq("org_id", orgId),
    admin.from("vehicles").select("id, unit_number").eq("org_id", orgId),
    admin.from("drivers").select("id, full_name, efs_driver_id").eq("org_id", orgId),
  ]);
  const vlist = (vehicles ?? []) as { id: string; unit_number: string }[];
  const dlist = (drivers ?? []) as { id: string; full_name: string; efs_driver_id: string | null }[];
  let changed = 0;
  for (const row of (declines ?? []) as {
    id: string;
    unit: string | null;
    driver_ext_id: string | null;
    driver_name: string | null;
    vehicle_id: string | null;
    driver_id: string | null;
  }[]) {
    const a = attributeDeclinedRow(row, vlist, dlist);
    const patch: Record<string, unknown> = {};
    if (!row.vehicle_id && a.vehicle_id) patch.vehicle_id = a.vehicle_id;
    if (!row.driver_id && a.driver_id) patch.driver_id = a.driver_id;
    if (Object.keys(patch).length) {
      await admin.from("declined_transactions").update(patch).eq("id", row.id);
      changed += 1;
    }
  }
  return changed;
}

/** Score every declined attempt for an org (newest first). Returns the count scored. */
export async function scoreDeclinedOrg(admin: SupabaseClient, env: Env, orgId: string): Promise<number> {
  // Refresh the inputs first so a "Rescore" heals history end-to-end: card→truck assignments from
  // fill history (WP1 D4), then attribution for rows imported before the WP1 fix (D2).
  await syncCardAssignments(admin, orgId).catch(() => undefined); // best-effort — scoring works without it
  await attributeDeclines(admin, orgId);
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
