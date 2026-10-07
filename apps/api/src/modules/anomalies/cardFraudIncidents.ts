import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyFraudAttempt,
  cardFraudKey,
  failedPromptOf,
  opensFraudIncident,
  type DeclineReasonCategory,
  type FraudAttempt,
  type FraudIncident,
  type TruckPosition,
} from "@silvicom/shared";
import type { FtxnRow } from "./scoring/loaders.js";
import type { ReconResult } from "./scoring/reconcile.js";

/**
 * The decline and fill scorers record card fraud incidents (CF2, docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md
 * D-CF1/D-CF2; F02-F04 PLAN.md chunk 5c). The rule is `packages/shared/src/cardFraud.ts` (5a); the store
 * and its one writer, `card_fraud_record`, are migration 0438 (5b). This file is only the loop between
 * them: read the card's latest incident, apply the attempt, write, and on a refusal read again.
 *
 * RECORDS ONLY. Nothing here notifies: delivery is CF4, and until then the decline's own alert
 * (`declined_alert`) is untouched.
 *
 * HISTORY IS RECORDED (settled in chunk 5c, measured on production 2026-10-07). The boot rebuild re-scores 180 days
 * of fills, not declines; of 11,828 fills in that window, 5 have Samsara's "away" verdict, so the first
 * deploy opens at most 5 incidents (2026-04-15 → 09-03). Declines are scored only at import and by the
 * Rejections "Rescore" button. A date cutoff here would be a second copy of the detection epoch that
 * chunk 7 (D-CF9) builds as an audited setting, so there is none: the epoch decides what is shown and
 * told, and the store keeps the evidence.
 */

const MAX_TRIES = 3;

const INCIDENT_COLS =
  "id, version, incident_key, card_ref, vehicle_id, opened_at, last_attempt_at, level, places, steps, failed_prompts, fuel_taken, last_truck, status";

interface IncidentRow {
  id: string;
  version: number;
  incident_key: string;
  card_ref: string;
  vehicle_id: string | null;
  opened_at: string;
  last_attempt_at: string;
  level: FraudIncident["level"];
  places: FraudIncident["places"];
  steps: FraudIncident["steps"];
  failed_prompts: FraudIncident["failedPrompts"];
  fuel_taken: boolean;
  last_truck: FraudIncident["lastTruck"];
  status: string;
}

/**
 * `not_fraud`: D-CF1 does not hold, so nothing was read or written. `already_recorded`: the attempt is in
 * the card's latest incident (a re-score). `recorded` / `duplicate`: the writer's own answer.
 */
export type FraudRecordOutcome = "not_fraud" | "already_recorded" | "recorded" | "duplicate";

const iso = (t: string) => new Date(t).toISOString();

/** The card's latest incident, as `card_fraud_record` judges "latest": the same order, so a read it accepts. */
async function latestIncident(admin: SupabaseClient, orgId: string, cardKey: string): Promise<IncidentRow | null> {
  const { data, error } = await admin
    .from("card_fraud_incidents")
    .select(INCIDENT_COLS)
    .eq("org_id", orgId)
    .eq("card_key", cardKey)
    .order("opened_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`card_fraud_incidents read failed: ${error.message}`);
  return (data as IncidentRow | null) ?? null;
}

async function asIncident(admin: SupabaseClient, orgId: string, row: IncidentRow): Promise<FraudIncident> {
  const { data, error } = await admin
    .from("card_fraud_incident_attempts")
    .select("source_id")
    .eq("org_id", orgId)
    .eq("incident_id", row.id);
  if (error) throw new Error(`card_fraud_incident_attempts read failed: ${error.message}`);
  return {
    key: row.incident_key,
    cardRef: row.card_ref,
    vehicleId: row.vehicle_id,
    openedAt: iso(row.opened_at),
    lastAttemptAt: iso(row.last_attempt_at),
    level: row.level,
    attemptIds: ((data ?? []) as Array<{ source_id: string }>).map((r) => r.source_id),
    places: row.places,
    failedPrompts: row.failed_prompts ?? [],
    fuelTaken: row.fuel_taken,
    lastTruck: row.last_truck,
    steps: row.steps,
    closed: row.status === "resolved" || row.status === "dismissed",
  };
}

/**
 * Record one attempt. An attempt D-CF1 does not qualify returns before any I/O: the boot rebuild runs
 * every fill of 180 days through here, and all but a handful must cost nothing.
 *
 * On `moved` (another worker wrote this card's incident since the read) or `closed` (a person closed it)
 * the loop reads again and re-applies, so the retry joins the other worker's incident or opens a new
 * one beside the person's. Three refusals in a row are not a race; that throws.
 */
export async function recordFraudAttempt(admin: SupabaseClient, orgId: string, a: FraudAttempt): Promise<FraudRecordOutcome> {
  if (!opensFraudIncident(a)) return "not_fraud";
  const cardKey = cardFraudKey(a.cardRef, a.vehicleId);
  for (let i = 0; i < MAX_TRIES; i++) {
    const latest = await latestIncident(admin, orgId, cardKey);
    const current = latest ? await asIncident(admin, orgId, latest) : null;
    const { incident, step } = applyFraudAttempt(current, a);
    if (!incident || incident === current) return "already_recorded";
    const { data, error } = await admin.rpc("card_fraud_record", {
      p_org: orgId,
      p_card_key: cardKey,
      p_card_ref: a.cardRef,
      p_read_id: latest?.id ?? null,
      p_read_version: latest?.version ?? null,
      p_incident_id: latest && incident.key === latest.incident_key ? latest.id : null,
      p_incident_key: incident.key,
      p_vehicle_id: incident.vehicleId,
      p_opened_at: incident.openedAt,
      p_last_attempt_at: incident.lastAttemptAt,
      p_level: incident.level,
      p_attempt_count: incident.attemptIds.length,
      p_fuel_taken: incident.fuelTaken,
      p_places: incident.places,
      p_failed_prompts: incident.failedPrompts,
      p_steps: incident.steps,
      p_last_truck: incident.lastTruck,
      p_attempt_source: a.source,
      p_attempt_id: a.id,
      p_attempted_at: a.at,
      p_step: step,
    });
    if (error) throw new Error(`card_fraud_record failed: ${error.message}`);
    const outcome = (data as Array<{ outcome: string }> | null)?.[0]?.outcome;
    if (outcome === "recorded" || outcome === "duplicate") return outcome;
    if (outcome !== "moved" && outcome !== "closed") throw new Error(`card_fraud_record answered ${String(outcome)}`);
  }
  throw new Error(`refused ${MAX_TRIES} times in a row`);
}

/**
 * What the scorers call. A failure is logged and swallowed, as `writeTruckPosition` does: the score is
 * already stored and still raises the decline's own alert, and a re-score records the attempt later.
 * The log names the attempt, never the card number (apps/api CLAUDE.md, PII).
 */
export async function recordCardFraud(admin: SupabaseClient, orgId: string, a: FraudAttempt | null): Promise<void> {
  if (!a) return;
  try {
    await recordFraudAttempt(admin, orgId, a);
  } catch (e) {
    console.warn(`[cardFraud] ${a.source} ${a.id} not recorded: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The decline columns an attempt is built from. */
interface FraudDecline {
  id: string;
  declined_at: string;
  card_ref: string | null;
  vehicle_id: string | null;
  city: string | null;
  state: string | null;
  error_description: string | null;
}

/**
 * A scored decline as an attempt. `explainedByFill` is the scorer's corrective fill, the one that turns
 * `location_mismatch` into `wrong_unit_number`, so the incident and the decline's own verdict cannot
 * disagree. No card ref, no card to hold an incident.
 */
export function declineFraudAttempt(
  d: FraudDecline,
  samsaraAtStation: boolean | null,
  explainedByFill: boolean,
  reason: DeclineReasonCategory,
  truck: TruckPosition | null,
): FraudAttempt | null {
  if (!d.card_ref) return null;
  return {
    id: d.id,
    source: "decline",
    at: iso(d.declined_at),
    cardRef: d.card_ref,
    vehicleId: d.vehicle_id,
    city: d.city,
    state: d.state,
    samsaraAtStation,
    explainedByFill,
    reason,
    failedPrompt: failedPromptOf(d.error_description),
    truck: truck && { at: truck.at, city: truck.city, state: truck.state, milesToStation: truck.milesToStation },
  };
}

/**
 * An approved fill as an attempt (D-CF1 "a decline OR an approved fill").
 *
 * `explainedByFill` is false: D-CF1's "a fill by the same truck at that station explains it" is the
 * decline's exoneration, and a fill IS the purchase. Measured on production 2026-10-07 (read-only): 5 of
 * 11,828 fills in 180 days have Samsara placing the truck away, 1 in the last 60 days (West Memphis,
 * 09-03). Four of the five have a tank rise matching the gallons (`tank_confirmed`), which looked like an
 * exoneration and is not one: card …67559 bought fuel in Bellemont, AZ at 17:34 on 06-06 and again in
 * Stratford, TX at 20:27, about 600 miles in three hours. So every one of the five opens an incident.
 *
 * The fill stores no GPS sample instant, so the truck's `at` is the moment Samsara matched the fill
 * (`samsara_recon_at`), else the fill's own time.
 */
export function fillFraudAttempt(
  r: Pick<FtxnRow, "id" | "fueled_at" | "card_ref" | "vehicle_id" | "city" | "state">,
  recon: Pick<ReconResult, "samsaraLocationMatched" | "reconAt" | "observedCity" | "observedState" | "nearestStationMiles">,
): FraudAttempt | null {
  if (!r.card_ref) return null;
  const seen = recon.observedCity != null || recon.observedState != null || recon.nearestStationMiles != null;
  return {
    id: r.id,
    source: "fill",
    at: iso(r.fueled_at),
    cardRef: r.card_ref,
    vehicleId: r.vehicle_id,
    city: r.city,
    state: r.state,
    samsaraAtStation: recon.samsaraLocationMatched,
    explainedByFill: false,
    reason: null,
    failedPrompt: null,
    truck: seen
      ? { at: iso(recon.reconAt ?? r.fueled_at), city: recon.observedCity, state: recon.observedState, milesToStation: recon.nearestStationMiles }
      : null,
  };
}
