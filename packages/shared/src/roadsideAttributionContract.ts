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
