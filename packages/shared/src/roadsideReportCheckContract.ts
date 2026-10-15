import type { AttributionDriverRefDto } from "./roadsideAttributionContract.js";

/**
 * What the officer's report says against the record (INSPECTION-CHALLENGE-PLAN IC10, D-IC13; Q-IC11 (a),
 * owner 2026-10-15). One check per filed report: is it this inspection, are these our units, and whose
 * licence is it — and when all of that agrees with the driver Samsara put on the truck, the report
 * confirms the driver with no person in between.
 *
 * Every reason is a sentence the safety office reads on the inspection's driver card, keyed by code so a
 * code added without a sentence fails the typecheck.
 */

/** The comparison's rule version (D-IC5): a change to it is a new version, and every report is checked again. */
export const REPORT_CHECK_VERSION = "ic10.1";

/**
 * `confirmed`   — every check agreed; a `report` attribution row was written (0479).
 * `agrees`      — every check agreed, but a person had already decided, so nothing was written over them.
 * `needs_review`— at least one check disagreed or could not be made; `reasons` say which.
 * `unreadable`  — the read failed, so nothing could be compared.
 */
export const REPORT_CHECK_OUTCOMES = ["confirmed", "agrees", "needs_review", "unreadable"] as const;
export type ReportCheckOutcome = (typeof REPORT_CHECK_OUTCOMES)[number];

export const REPORT_CHECK_REASONS = {
  report_number_not_read: "The report number could not be read from the paper.",
  report_number_mismatch: "The report number on the paper is not FMCSA's number for this inspection.",
  vin_mismatch: "A VIN on the paper is not one of the units FMCSA lists for this inspection.",
  licence_not_read: "The driver's licence number could not be read from the paper.",
  licence_readers_disagree: "The two readings of the licence number differ.",
  licence_not_printed: "The page's own text does not show the licence number that was read.",
  licence_not_on_roster: "No driver on our roster has this licence number.",
  licence_several_drivers: "More than one driver on our roster has this licence number.",
  samsara_no_driver: "Samsara does not name one driver on the truck at the inspection, so there is nothing to agree with.",
  samsara_other_driver: "Samsara puts a different driver on the truck than the licence on the report.",
  driver_not_in_samsara: "Our roster's driver for this licence has no Samsara account linked, so Samsara's driver cannot be compared.",
  name_differs: "The name on the report is not the name on our roster for that licence.",
} as const satisfies Record<string, string>;
export type ReportCheckReason = keyof typeof REPORT_CHECK_REASONS;
export const REPORT_CHECK_REASON_CODES = Object.keys(REPORT_CHECK_REASONS) as [ReportCheckReason, ...ReportCheckReason[]];

/**
 * The reasons that are recorded but do not stop a confirmation. A name is never what confirms (Q-IC11:
 * spelling, middle names, a name shared by two drivers) — and for the same reasons a differing one does
 * not refuse a licence two readers and the page agree on. It is shown, so a person can look.
 */
export const REPORT_CHECK_NOTES: readonly ReportCheckReason[] = ["name_differs"];

/** Where a filed report stands, for the driver card. */
export const REPORT_CHECK_STATES = ["waiting_for_file", "reading", "checked", "read_failed"] as const;
export type ReportCheckState = (typeof REPORT_CHECK_STATES)[number];

export interface RoadsideReportCheckDto {
  documentId: string;
  state: ReportCheckState;
  /** Set once `checked`. */
  outcome: ReportCheckOutcome | null;
  reasons: { code: ReportCheckReason; text: string }[];
  /** The driver's name as the report prints it, and the licence's last four characters — never the whole number. */
  nameOnReport: string | null;
  licenceLast4: string | null;
  /** Our roster's driver for the licence, when exactly one has it. */
  driver: AttributionDriverRefDto | null;
  checkedAt: string | null;
}
