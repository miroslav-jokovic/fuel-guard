import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * Who was driving at a roadside inspection, and when it happened — the vocabulary of IC5
 * (INSPECTION-CHALLENGE-PLAN D-IC7, D-IC8; tables `inspection_attributions` and
 * `inspection_evidence_snapshots`, migration 0473).
 *
 * Every list here is ALSO a CHECK constraint in 0473. The matrix `supabase/tests/inspection-attribution.test.mjs`
 * reads the applied constraints back and compares them with these arrays, so a value added on one side
 * only fails the build instead of failing an insert in production.
 *
 * ── THE TIME ON THE REPORT HAS NO ZONE (D-IC8) ─────────────────────────────────────────────────
 * The officer writes local HHMM. The report's state proposes the candidate zones (two in a split state
 * such as Texas or Kentucky, every mainland zone for a federal "US" report); the truck's GPS chooses —
 * the inspection is the candidate interval in which the truck stood still, in the report's state.
 *
 *   gps          exactly one candidate shows the truck stopped; that is the zone.
 *   state_only   the state has one zone, but the GPS did not confirm a stop (no fix, or moving).
 *   unresolved   several candidates and the GPS could not choose between them, or the report has no time.
 */
export const ATTRIBUTION_ZONE_METHODS = ["gps", "state_only", "unresolved"] as const;
export type AttributionZoneMethod = (typeof ATTRIBUTION_ZONE_METHODS)[number];

/**
 * What the GPS said about the truck during the inspection — D-IC8's "identity confirmed, or a
 * mismatch", recorded as its own finding.
 *
 *   confirmed    stopped, in the report's state.
 *   other_state  stopped, but in another state: the "not our truck / wrong information" signal.
 *   unplaced     stopped, but Samsara's address for the fix names no state.
 *   moving       the truck was moving throughout every candidate interval.
 *   no_gps       no fix near any candidate interval.
 */
export const ATTRIBUTION_LOCATION_CHECKS = ["confirmed", "other_state", "unplaced", "moving", "no_gps"] as const;
export type AttributionLocationCheck = (typeof ATTRIBUTION_LOCATION_CHECKS)[number];

/**
 * Who Samsara's HOS assignments put on the truck within two hours of the inspection (D-IC7).
 *
 *   one_driver          one driver and no co-driver: a candidate (its confidence says how strong).
 *   several_drivers     two drivers, or a team (a passenger assignment): a person decides.
 *   no_assignment       nobody was assigned in the window: a person decides.
 *   no_samsara_vehicle  the inspected tractor is ours but has no Samsara id, so nothing could be asked.
 *   no_matched_tractor  the report's power unit is not matched to a truck of ours (0458; Q-IC10).
 */
export const ATTRIBUTION_OUTCOMES = ["one_driver", "several_drivers", "no_assignment", "no_samsara_vehicle", "no_matched_tractor"] as const;
export type AttributionOutcome = (typeof ATTRIBUTION_OUTCOMES)[number];

/**
 * How the one driver's assignments sit against the inspection. A driver logged in on the truck during
 * it (`covering`), or on it before AND after it (`bracketing` — measured: Samsara closes the HOS
 * assignment while the truck stands at the scale, 698 on 2026-09-22 was assigned until 18:04Z and again
 * from 18:42Z around a 18:04–18:42Z stop), is a strong reading. On it only before, or only after, is not.
 */
export const ATTRIBUTION_BASES = ["covering", "bracketing", "before_only", "after_only"] as const;
export type AttributionBasis = (typeof ATTRIBUTION_BASES)[number];

/** `high` only for one driver, covering or bracketing, at a usable instant. Anything else is `low` and goes to a person. */
export const ATTRIBUTION_CONFIDENCES = ["high", "low"] as const;
export type AttributionConfidence = (typeof ATTRIBUTION_CONFIDENCES)[number];

/** The engine wrote it, or a person confirmed or corrected it (a correction is a new row, never an edit). */
export const ATTRIBUTION_SOURCES = ["engine", "person"] as const;
export type AttributionSource = (typeof ATTRIBUTION_SOURCES)[number];

/** What a frozen snapshot holds (D-IC4). The plan's other kinds (EFS, credentials, documents) arrive with their rules. */
export const EVIDENCE_KINDS = ["gps_window", "assignments", "hos_logs", "dvirs"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * D-IC4: evidence is classed by its own timestamp. Post-event evidence can never support a "did not
 * exist" finding. A day's DVIRs hold both kinds, so the snapshot is `context` and its summary classes
 * each report against the inspection.
 */
export const EVIDENCE_TEMPORAL_CLASSES = ["contemporaneous", "post_event", "context"] as const;
export type EvidenceTemporalClass = (typeof EVIDENCE_TEMPORAL_CLASSES)[number];

/**
 * The rule version an attribution row records (D-IC5): a change to the reading is a new version, and
 * the backlog re-runs it. A person's row carries the version of the reading it decided over.
 */
export const ATTRIBUTION_ENGINE_VERSION = "ic5.1";

/**
 * What the Inspection page says about each finding (INSPECTION-CHALLENGE-PLAN §6: "driver with
 * confidence and a 'confirm' action"). Keyed by the enums above, so a value added there and not here
 * fails the typecheck rather than printing a code.
 */
export const ATTRIBUTION_OUTCOME_TEXT: Record<AttributionOutcome, string> = {
  one_driver: "One driver was logged in on the truck.",
  several_drivers: "More than one driver was logged in on the truck around the inspection, or a team was driving.",
  no_assignment: "Nobody was logged in on the truck within two hours of the inspection.",
  no_samsara_vehicle: "The inspected truck is ours but is not in Samsara, so there is no driver log to read.",
  no_matched_tractor: "The report's power unit is not matched to one of our trucks.",
};
export const ATTRIBUTION_BASIS_TEXT: Record<AttributionBasis, string> = {
  covering: "logged in on the truck during the inspection",
  bracketing: "logged in on the truck just before and just after the inspection",
  before_only: "logged in on the truck before the inspection, but not after it",
  after_only: "logged in on the truck after the inspection, but not before it",
};
export const ATTRIBUTION_LOCATION_TEXT: Record<AttributionLocationCheck, string> = {
  confirmed: "The truck's GPS shows it stopped in the report's state.",
  other_state: "The truck's GPS shows it stopped in a different state from the report's.",
  unplaced: "The truck's GPS shows it stopped, but not in which state.",
  moving: "The truck's GPS shows it moving at the report's time.",
  no_gps: "The truck's GPS has no position near the report's time.",
};
export const ATTRIBUTION_ZONE_TEXT: Record<AttributionZoneMethod, string> = {
  gps: "time zone read from where the truck stood",
  state_only: "time zone of the report's state",
  unresolved: "time zone could not be told from the GPS",
};

/** One of our drivers, by roster id and name. */
export interface AttributionDriverRefDto {
  id: string;
  name: string;
}

/**
 * The engine's latest reading (any version; the backlog re-reads at a new version). Samsara's driver
 * is the evidence; `driver` is our roster's row for that Samsara id, null when the roster has none —
 * measured 2026-10-14 on production: 916 of the 1,117 Samsara drivers in our HOS history are not on
 * the roster, so "not on our roster" is the common answer for an older inspection, never a name match.
 */
export interface RoadsideAttributionReadingDto {
  id: string;
  engineVersion: string;
  readAt: string;
  outcome: AttributionOutcome;
  confidence: AttributionConfidence | null;
  basis: AttributionBasis | null;
  zone: string | null;
  zoneMethod: AttributionZoneMethod;
  startedAt: string | null;
  endedAt: string | null;
  locationCheck: AttributionLocationCheck;
  samsaraDriver: { id: string; name: string | null } | null;
  driver: AttributionDriverRefDto | null;
  /** Everyone the assignments put on the truck within the window — the choices behind `several_drivers`. */
  candidates: { samsaraDriverId: string; name: string | null; passenger: boolean; driver: AttributionDriverRefDto | null }[];
}

/**
 * A person's latest decision. `confirmed` stands behind the reading as it is (the row carries no
 * driver of its own); `corrected` names one of our drivers and says why in `note`.
 */
export interface RoadsideAttributionDecisionDto {
  id: string;
  kind: "confirmed" | "corrected";
  /** The corrected driver; null for a confirmation, and for a correction whose driver row is gone (merged). */
  driver: AttributionDriverRefDto | null;
  decidedBy: string | null;
  decidedAt: string;
  note: string | null;
  /** The engine version the person decided over; differs from the reading's after a re-read. */
  engineVersion: string;
}

/** `reading` is null until the backlog reaches the inspection (25 an hour, newest first). */
export interface RoadsideAttributionDto {
  reading: RoadsideAttributionReadingDto | null;
  decision: RoadsideAttributionDecisionDto | null;
  /** The row a decision is made over — the newer of the two — sent back as the decision's `basedOn`. */
  basedOn: string | null;
}

/**
 * `POST /api/roadside-inspections/:id/attribution`. `basedOn` is the row the page showed (the decision,
 * else the reading): a decision made over a row that is no longer the latest is refused, so two people
 * never overwrite each other unseen. A correction must say what shows it was that driver.
 */
export const roadsideAttributionDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), basedOn: recordId(), note: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal("correct"), basedOn: recordId(), driverId: recordId(), note: z.string().trim().min(1).max(1000) }),
]);
export type RoadsideAttributionDecision = z.infer<typeof roadsideAttributionDecisionSchema>;
