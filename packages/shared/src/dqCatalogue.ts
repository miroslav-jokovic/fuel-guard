/**
 * The §391.51 catalogue — WHAT a driver qualification file is made of, with no opinion about whether
 * any particular file is complete. `dqFile.ts` is the judgement; this is the vocabulary it judges
 * against, and they are separate files because the catalogue is regulation and the builder is logic:
 * one changes when the FMCSA changes, the other when we find a bug.
 *
 * Split out when dqFile.ts crossed the 500-line budget. Deliberately split rather than grandfathered
 * — the budget's own comment says that list may only shrink.
 */

/** Where an item's evidence lives: a `certifications` row, or a `qualification_records` row. */
export type DqEvidenceSource = "certification" | "record";

/**
 * How an item goes stale.
 *   expiry     — the evidence carries its own expiry date (CDL, medical certificate)
 *   annual     — good for one year from the date it happened (§391.25 review, §382.701(b) query)
 *   triennial  — good for three years from the date it was issued (§172.704(c)(2) training)
 *   one_time   — a hiring-time event that never expires (application, road test, pre-employment MVR)
 */
export type DqRecurrence = "expiry" | "annual" | "triennial" | "one_time";

/** `hazmat` items only apply to a carrier running the HazmatGuard module. */
export type DqScope = "always" | "hazmat";

export type DqItemState = "current" | "expiring" | "expired" | "missing";

/**
 * The five things a §391.51 file is actually made of (D-DQ8). Eighteen flat rows render an
 * employment application from 2019 identically to a CDL expiring on Tuesday; grouping is what lets a
 * complete section collapse to one line so a clean driver is a short page.
 *
 * Order matters — it is the order the groups are shown in, and it is roughly the order an auditor
 * works through: who they are, whether they may drive, how they were hired, what recurs, what the
 * module adds.
 */
export const DQ_GROUPS = ["licence", "medical", "hiring", "recurring", "hazmat"] as const;
export type DqGroup = (typeof DQ_GROUPS)[number];

export const DQ_GROUP_LABELS: Record<DqGroup, string> = {
  licence: "Licence",
  medical: "Medical",
  hiring: "Hiring file",
  recurring: "Recurring obligations",
  hazmat: "Hazmat",
};

export interface DqItemSpec {
  key: string;
  label: string;
  citation: string;
  source: DqEvidenceSource;
  /** Any one of these `kind` values satisfies the item — §391.51(b)(4) accepts a road test OR the
   *  §391.33 licence equivalency, which is one requirement with two lawful evidences. */
  evidenceKinds: string[];
  /** Endorsements: any of these qualifier letters satisfies it. */
  qualifiers?: string[];
  /** Hazmat training: the §172.704(a) type this item is about. */
  trainingType?: string;
  recurrence: DqRecurrence;
  group: DqGroup;
  scope: DqScope;
  /** The retention rule, as text. Shown, never acted on. */
  retention: string;
}

/**
 * §391.51(b) and its companions, in the order an auditor works through them: hire, licence, medical,
 * then the recurring obligations. `eldt` and the Clearinghouse items are not in §391.51(b) itself but
 * are asked for alongside it and have nowhere else to live.
 *
 * Deliberately absent: the tank endorsement (equipment-dependent, the gate's business, not the
 * file's) and the §391.27 annual list of violations (removed in 2020, superseded by the
 * Clearinghouse query — filing it would be teaching a carrier a requirement that no longer exists).
 */
export const DQ_ITEMS: readonly DqItemSpec[] = [
  {
    key: "employment_application",
    label: "Employment application",
    citation: "49 CFR §391.21 / §391.51(b)(1)",
    source: "record",
    evidenceKinds: ["employment_application"],
    recurrence: "one_time",
    group: "hiring",
    scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "mvr_preemployment",
    label: "Pre-employment driving record inquiry",
    citation: "49 CFR §391.23(a)(1) / §391.51(b)(2)",
    source: "record",
    evidenceKinds: ["mvr"],
    recurrence: "one_time",
    group: "hiring",
    scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "previous_employer_inquiry",
    label: "Previous-employer safety inquiry sent",
    citation: "49 CFR §391.23(a)(2)",
    source: "record",
    evidenceKinds: ["previous_employer_inquiry"],
    recurrence: "one_time",
    group: "hiring",
    scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "previous_employer_response",
    label: "Previous-employer response (or documented non-response)",
    citation: "49 CFR §391.23(d)",
    source: "record",
    evidenceKinds: ["previous_employer_response"],
    recurrence: "one_time",
    group: "hiring",
    scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "road_test",
    label: "Road test certificate, or licence equivalency",
    citation: "49 CFR §391.31 / §391.33 / §391.51(b)(4)-(5)",
    source: "record",
    evidenceKinds: ["road_test", "cdl_equivalency"],
    recurrence: "one_time",
    group: "hiring",
    scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "eldt",
    label: "Entry-level driver training",
    citation: "49 CFR §380.725",
    source: "record",
    evidenceKinds: ["eldt"],
    recurrence: "one_time",
    group: "hiring",
    scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "cdl",
    label: "Commercial driver's licence",
    citation: "49 CFR §391.51(b)(6)",
    source: "certification",
    evidenceKinds: ["cdl"],
    recurrence: "expiry",
    group: "licence",
    scope: "always",
    retention: "Superseded copies are retained; the file keeps the chain (§391.51(c)).",
  },
  {
    key: "medical_card",
    label: "Medical examiner's certificate",
    citation: "49 CFR §391.43 / §391.51(b)(7)",
    source: "certification",
    evidenceKinds: ["medical_card"],
    recurrence: "expiry",
    group: "medical",
    scope: "always",
    retention: "Retained for 3 years from the date of issue (§391.51(d)(2)).",
  },
  {
    key: "medical_registry_verification",
    label: "National Registry examiner verification",
    citation: "49 CFR §391.23(m)",
    source: "record",
    evidenceKinds: ["medical_registry_verification"],
    recurrence: "one_time",
    group: "medical",
    scope: "always",
    retention: "Retained for 3 years from the date of the verification (§391.23(m)(2)).",
  },
  {
    key: "drug_test_preemployment",
    label: "Pre-employment controlled-substances test",
    citation: "49 CFR §382.301",
    source: "record",
    evidenceKinds: ["drug_test"],
    recurrence: "one_time",
    group: "hiring",
    scope: "always",
    retention: "Held in the confidential DOT testing file, separate from the DQ file (§40.333).",
  },
  {
    key: "clearinghouse_preemployment",
    label: "Clearinghouse full query (pre-employment)",
    citation: "49 CFR §382.701(a)",
    source: "record",
    evidenceKinds: ["clearinghouse_full"],
    recurrence: "one_time",
    group: "hiring",
    scope: "always",
    retention: "Retained for 3 years (§382.701(d)).",
  },
  {
    key: "annual_mvr_review",
    label: "Annual review of driving record",
    citation: "49 CFR §391.25 / §391.51(b)(8)",
    source: "record",
    evidenceKinds: ["annual_mvr_review"],
    recurrence: "annual",
    group: "recurring",
    scope: "always",
    retention: "Retained for 3 years from the date of the review (§391.51(d)(1)).",
  },
  {
    key: "clearinghouse_annual",
    label: "Clearinghouse limited query (annual)",
    citation: "49 CFR §382.701(b)",
    source: "record",
    evidenceKinds: ["clearinghouse_limited"],
    recurrence: "annual",
    group: "recurring",
    scope: "always",
    retention: "Retained for 3 years (§382.701(d)).",
  },
  {
    key: "endorsement_hazmat",
    label: "Hazmat endorsement (H or X)",
    citation: "49 CFR §383.93",
    source: "certification",
    evidenceKinds: ["endorsement"],
    qualifiers: ["H", "X"],
    recurrence: "expiry",
    group: "hazmat",
    scope: "hazmat",
    retention: "Superseded copies are retained; the file keeps the chain (§391.51(c)).",
  },
  {
    key: "training_general_awareness",
    label: "Hazmat training — general awareness",
    citation: "49 CFR §172.704(a)(1)",
    source: "certification",
    evidenceKinds: ["hazmat_training"],
    trainingType: "general_awareness",
    recurrence: "triennial",
    group: "hazmat",
    scope: "hazmat",
    retention: "Retained while employed and for 90 days afterwards (§172.704(d)).",
  },
  {
    key: "training_function_specific",
    label: "Hazmat training — function specific",
    citation: "49 CFR §172.704(a)(2)",
    source: "certification",
    evidenceKinds: ["hazmat_training"],
    trainingType: "function_specific",
    recurrence: "triennial",
    group: "hazmat",
    scope: "hazmat",
    retention: "Retained while employed and for 90 days afterwards (§172.704(d)).",
  },
  {
    key: "training_safety",
    label: "Hazmat training — safety",
    citation: "49 CFR §172.704(a)(3)",
    source: "certification",
    evidenceKinds: ["hazmat_training"],
    trainingType: "safety",
    recurrence: "triennial",
    group: "hazmat",
    scope: "hazmat",
    retention: "Retained while employed and for 90 days afterwards (§172.704(d)).",
  },
  {
    key: "training_security_awareness",
    label: "Hazmat training — security awareness",
    citation: "49 CFR §172.704(a)(4)",
    source: "certification",
    evidenceKinds: ["hazmat_training"],
    trainingType: "security_awareness",
    recurrence: "triennial",
    group: "hazmat",
    scope: "hazmat",
    retention: "Retained while employed and for 90 days afterwards (§172.704(d)).",
  },
] as const;
