import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyFraudAttempt,
  failedPromptOf,
  isFullCardNumber,
  type DeclineReasonCategory,
  type DeclineSignal,
  type FraudAttempt,
  type FraudIncident,
  type FraudStep,
  type TruckPosition,
} from "@silvicom/shared";

/**
 * Record one qualifying attempt — a card used where its truck isn't — against that card's incident
 * (CF2, docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md; migration 0410).
 *
 * Read the card's latest incident, apply the pure reducer, write through `card_fraud_record`, which
 * refuses a write made against a version that has since moved, an incident a person has closed in
 * the meantime, or an attempt already recorded. A refusal re-reads and re-applies; three refusals in
 * a row means something other than a race, and is reported rather than looped on.
 *
 * Returns the step the attempt took — what the caller notifies on (CF4) — or null when it took none
 * (more of the same, a re-score, or history arriving late).
 */
export interface RecordedFraudAttempt {
  incidentId: string;
  incident: FraudIncident;
  step: FraudStep | null;
}

const MAX_TRIES = 3;

interface IncidentRow {
  id: string;
  incident_key: string;
  version: number;
  status: string;
  state: Omit<FraudIncident, "closed">;
}

/** The card's most recent incident. A masked card ref names a card only together with its truck. */
async function latestIncident(admin: SupabaseClient, orgId: string, a: FraudAttempt): Promise<IncidentRow | null> {
  let q = admin
    .from("card_fraud_incidents")
    .select("id, incident_key, version, status, state")
    .eq("org_id", orgId)
    .eq("card_ref", a.cardRef);
  if (!isFullCardNumber(a.cardRef)) q = a.vehicleId ? q.eq("vehicle_id", a.vehicleId) : q.is("vehicle_id", null);
  const { data, error } = await q.order("last_attempt_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`card_fraud_incidents read failed: ${error.message}`);
  return (data as IncidentRow | null) ?? null;
}

/** Already in an incident? Then a re-score is a no-op and must not even read the incident. */
async function alreadyRecorded(admin: SupabaseClient, orgId: string, a: FraudAttempt): Promise<boolean> {
  const { data, error } = await admin
    .from("card_fraud_incident_attempts")
    .select("incident_id")
    .eq("org_id", orgId)
    .eq("source", a.source)
    .eq("source_id", a.id)
    .maybeSingle();
  if (error) throw new Error(`card_fraud_incident_attempts read failed: ${error.message}`);
  return data != null;
}

export async function recordFraudAttempt(admin: SupabaseClient, orgId: string, a: FraudAttempt): Promise<RecordedFraudAttempt | null> {
  if (await alreadyRecorded(admin, orgId, a)) return null;

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const row = await latestIncident(admin, orgId, a);
    const current: FraudIncident | null = row
      ? { ...row.state, closed: row.status === "resolved" || row.status === "dismissed" }
      : null;
    const result = applyFraudAttempt(current, a);
    if (result.duplicate) return null;

    const joins = row != null && result.incident.key === row.incident_key;
    const { closed: _closed, ...state } = result.incident;
    const { data, error } = await admin.rpc("card_fraud_record", {
      p_org: orgId,
      p_incident_key: result.incident.key,
      p_expected_version: joins ? row.version : null,
      p_card_ref: result.incident.cardRef,
      p_vehicle_id: result.incident.vehicleId,
      p_opened_at: result.incident.openedAt,
      p_last_attempt_at: result.incident.lastAttemptAt,
      p_attempt_count: result.incident.attemptIds.length,
      p_fuel_taken: result.incident.fuelTaken,
      p_state: state,
      p_attempt_source: a.source,
      p_attempt_id: a.id,
      p_attempted_at: a.at,
      p_step: result.step,
    });
    if (error) throw new Error(`card_fraud_record failed: ${error.message}`);
    const written = (data as Array<{ incident_id: string; version: number }> | null)?.[0];
    if (written) return { incidentId: written.incident_id, incident: result.incident, step: result.step };
    // Refused: another worker moved the incident, a person closed it, or this attempt landed first.
    if (await alreadyRecorded(admin, orgId, a)) return null;
  }
  throw new Error(`card fraud attempt ${a.source}:${a.id} was refused ${MAX_TRIES} times — not a race`);
}

/** The decline columns an attempt is built from — the scorer's row, narrowed to what this reads. */
export interface FraudDecline {
  id: string;
  declined_at: string;
  card_ref: string | null;
  vehicle_id: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  error_description: string | null;
}

/**
 * CF2 (CARD-FRAUD-ALERTS-PLAN.md D-CF1): a decline that kept `location_mismatch` — Samsara had the
 * card's truck elsewhere and no fill by that truck at that station explained it — is a use of the
 * card where its truck isn't, and joins that card's incident. The signal is the whole test, read
 * from what was just stored, so the incident and the decline's own verdict cannot disagree.
 */
export async function recordDeclineFraudAttempt(
  admin: SupabaseClient,
  orgId: string,
  d: FraudDecline,
  stored: DeclineSignal[],
  category: DeclineReasonCategory,
  truck: TruckPosition | null,
): Promise<void> {
  if (!d.card_ref || !stored.some((r) => r.key === "location_mismatch")) return;
  await recordFraudAttempt(admin, orgId, {
    id: d.id,
    source: "decline",
    at: d.declined_at,
    cardRef: d.card_ref,
    vehicleId: d.vehicle_id,
    unit: d.unit,
    city: d.city,
    state: d.state,
    reason: category,
    failedPrompt: failedPromptOf(d.error_description),
    truck,
  }).catch((e: unknown) => {
    // Logged, not thrown: one refused write must not stop the rest of an import being scored. The
    // decline's own `alert` verdict is stored and still notifies through emitDeclinedAlerts until CF4
    // moves delivery onto incidents; a re-score records the attempt then.
    console.error(`[declinedScoring] fraud attempt not recorded for ${d.id}: ${e instanceof Error ? e.message : String(e)}`);
  });
}
