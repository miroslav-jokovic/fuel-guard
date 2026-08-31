import { z } from "zod";
import {
  INSPECTION_ITEMS,
  INSPECTION_RESULTS,
  INSPECTION_SUBJECT_TYPES,
  inspectionItem,
  isInspectionItemApplicable,
  type InspectionResult,
  type InspectionSubjectType,
} from "./annualInspectionCatalogue.js";

/**
 * The §396.17 annual inspection contract — `/api/maintenance/inspections`
 * (`docs/plans/maintenance/ANNUAL-INSPECTION-PLAN.md`, D-AVI3/D-AVI5).
 *
 * ── THE RULE THIS FILE EXISTS TO MAKE UNTYPEABLE ────────────────────────────────────────────────
 * The Keller form carries a pre-printed sentence: "THIS VEHICLE HAS PASSED ALL THE INSPECTION ITEMS
 * FOR THE ANNUAL VEHICLE INSPECTION IN ACCORDANCE WITH 49 CFR PART 396." On paper that sentence is
 * true because the inspector says so. Here it is true because `deriveInspectionOutcome` says so, and
 * there is no field anywhere in which a human can type "pass".
 *
 * That is not pedantry. Appendix A is a list of conditions under which a vehicle FAILS; §396.17(a)
 * requires every component in it to have passed. A report certifying a pass beside an unrepaired
 * defect is a false certification, and it is the single most legible thing a DOT auditor or an
 * opposing expert can find in a maintenance file after a crash.
 *
 * ── AND THE ONE THAT MAKES A BLANK IMPOSSIBLE ───────────────────────────────────────────────────
 * §396.21(a)(5) requires the report to identify the components inspected AND describe the results.
 * A blank cell describes nothing, so a missing result is an ERROR here rather than a defaulted
 * `na`. The web form opens pre-filled (D-AVI13) precisely so that this rule costs the inspector
 * nothing — but the rule is enforced against the payload, not against the form.
 *
 * Everything below is pure: no clock, no database, no I/O. The API and the browser run the same
 * function over the same payload, so the banner on the screen and the word stamped on the PDF
 * cannot disagree.
 */

// ── vocabularies ─────────────────────────────────────────────────────────────────────────────────

export const inspectionResultSchema = z.enum(INSPECTION_RESULTS);
export const inspectionSubjectTypeSchema = z.enum(INSPECTION_SUBJECT_TYPES);

/** Where an item's answer came from (D-AVI13). The form opens pre-filled; this records what moved. */
export const INSPECTION_ITEM_SOURCES = ["default", "inspector"] as const;
export const inspectionItemSourceSchema = z.enum(INSPECTION_ITEM_SOURCES);
export type InspectionItemSource = (typeof INSPECTION_ITEM_SOURCES)[number];

export const INSPECTION_STATUSES = ["draft", "final"] as const;
export const inspectionStatusSchema = z.enum(INSPECTION_STATUSES);
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const INSPECTION_OUTCOMES = ["pass", "fail"] as const;
export const inspectionOutcomeSchema = z.enum(INSPECTION_OUTCOMES);
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number];

/**
 * How the vehicle is identified on the report — §396.21(a)(4), and the form's own
 * "VEHICLE IDENTIFICATION (✓ AND COMPLETE)" row. The sample ticks VIN.
 */
export const VEHICLE_IDENTIFICATION_METHODS = ["vin", "plate", "other"] as const;
export const vehicleIdentificationMethodSchema = z.enum(VEHICLE_IDENTIFICATION_METHODS);
export type VehicleIdentificationMethod = (typeof VEHICLE_IDENTIFICATION_METHODS)[number];

/**
 * §396.19(b) — the two ways an inspector qualifies. Kept as a closed vocabulary because the report
 * asserts it ("THIS INSPECTOR MEETS THE QUALIFICATION REQUIREMENTS IN SECTION 396.19") and D-AVI6
 * derives that assertion from a record rather than from a checkbox.
 */
export const INSPECTOR_QUALIFICATION_BASES = ["state_federal_program", "training_and_experience"] as const;
export const inspectorQualificationBasisSchema = z.enum(INSPECTOR_QUALIFICATION_BASES);
export type InspectorQualificationBasis = (typeof INSPECTOR_QUALIFICATION_BASES)[number];

// ── dates ────────────────────────────────────────────────────────────────────────────────────────

/**
 * A real calendar date, not merely a well-shaped string. `2026-02-31` matches the regex and then
 * either becomes a Postgres error or, worse, a next-due date twelve months from a day that never
 * existed. The inspection date is what the whole expiry rests on, so it gets the strict check —
 * the same argument `dateOfBirthSchema` makes for a PSP match key.
 */
export const inspectionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, "Not a real calendar date");

/**
 * When the next inspection falls due — §396.17(a), "at least once during the preceding 12 months".
 *
 * Twelve months from the day of inspection, with a day clamp so 29 February yields 28 February
 * rather than rolling into March. Deliberately the STRICT reading: §396.23 lets a state programme
 * run to the last day of the month, which is always later, so a carrier using this date can never
 * believe a vehicle is current when it is not. Erring the other way would be a compliance surface
 * that flatters itself.
 *
 * Pure by construction — it takes the inspection date rather than reading a clock, so it is
 * testable and gives the same answer in every timezone the office ever runs in.
 */
export function nextInspectionDueDate(inspectedOn: string): string {
  const [y, m, d] = inspectedOn.split("-").map(Number) as [number, number, number];
  const daysInTargetMonth = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  const day = Math.min(d, daysInTargetMonth);
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ── the outcome derivation (D-AVI3, D-AVI5) ──────────────────────────────────────────────────────

export interface InspectionItemAnswer {
  readonly key: string;
  readonly result: InspectionResult;
  /** §396.21(a)(5): the date a component that needed repair was repaired. */
  readonly repairedAt?: string | null;
}

/**
 * Why a set of answers cannot yet be certified. Every code names the items responsible, because
 * "this report is incomplete" is not something an inspector can act on and "brake hose has no
 * result" is.
 */
export type InspectionIssue =
  | { code: "missing_result"; itemKeys: string[] }
  | { code: "unknown_item"; itemKeys: string[] }
  | { code: "duplicate_item"; itemKeys: string[] }
  | { code: "inapplicable_not_na"; itemKeys: string[] }
  | { code: "repair_date_without_defect"; itemKeys: string[] }
  | { code: "repair_date_before_inspection"; itemKeys: string[] };

export type InspectionDerivation =
  | {
      ok: true;
      outcome: InspectionOutcome;
      /** Components that need repair and have no repair date — the reason a `fail` is a fail. */
      openDefects: string[];
      /** Components that needed repair and were repaired. A pass, with a history. */
      repairedDefects: string[];
    }
  | { ok: false; issues: InspectionIssue[] };

/**
 * The one function that decides whether this vehicle passed.
 *
 * Called by the finalize route before anything is written, by the browser to render the banner, and
 * by the renderer to choose what to stamp. One implementation, three callers — a second one would
 * be a second answer to a regulatory question.
 */
export function deriveInspectionOutcome(
  answers: readonly InspectionItemAnswer[],
  subjectType: InspectionSubjectType,
  inspectedOn: string,
): InspectionDerivation {
  const issues: InspectionIssue[] = [];
  const push = (code: InspectionIssue["code"], keys: string[]): void => {
    if (keys.length > 0) issues.push({ code, itemKeys: keys } as InspectionIssue);
  };

  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  const inapplicable: string[] = [];
  const strayRepairDate: string[] = [];
  const earlyRepairDate: string[] = [];
  const openDefects: string[] = [];
  const repairedDefects: string[] = [];

  for (const a of answers) {
    if (seen.has(a.key)) duplicates.push(a.key);
    seen.add(a.key);

    const item = inspectionItem(a.key);
    if (!item) {
      unknown.push(a.key);
      continue;
    }
    // An item that cannot exist on this equipment may only be `na`. See the catalogue's
    // `isInspectionItemApplicable` for why this is locked rather than merely defaulted.
    if (!isInspectionItemApplicable(item, subjectType) && a.result !== "na") {
      inapplicable.push(a.key);
    }
    const repairedAt = a.repairedAt ?? null;
    if (repairedAt !== null && a.result !== "needs_repair") strayRepairDate.push(a.key);
    // A repair dated before the inspection is not this inspection's repair; it is a typo or a
    // different visit, and either way it cannot discharge a defect this report found.
    if (repairedAt !== null && a.result === "needs_repair" && repairedAt < inspectedOn) {
      earlyRepairDate.push(a.key);
    }
    if (a.result === "needs_repair") {
      if (repairedAt === null || repairedAt < inspectedOn) openDefects.push(a.key);
      else repairedDefects.push(a.key);
    }
  }

  // D-AVI5: every component the catalogue knows must be answered. Absence is not `na`.
  const missing = INSPECTION_ITEMS.filter((i) => !seen.has(i.key)).map((i) => i.key);

  push("missing_result", missing);
  push("unknown_item", unknown);
  push("duplicate_item", duplicates);
  push("inapplicable_not_na", inapplicable);
  push("repair_date_without_defect", strayRepairDate);
  push("repair_date_before_inspection", earlyRepairDate);

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    outcome: openDefects.length === 0 ? "pass" : "fail",
    openDefects,
    repairedDefects,
  };
}

// ── request schemas ──────────────────────────────────────────────────────────────────────────────

const noteSchema = z.string().max(500).nullish();

export const inspectionItemAnswerSchema = z.object({
  key: z.string().min(1).max(80),
  result: inspectionResultSchema,
  repairedAt: inspectionDateSchema.nullish(),
  note: noteSchema,
});

/** POST — the draft. Client-generated id so a retried submit does not create a second report. */
export const inspectionCreateSchema = z.object({
  id: z.uuid(),
  subjectType: inspectionSubjectTypeSchema,
  subjectId: z.uuid(),
  inspectorId: z.uuid(),
  inspectedOn: inspectionDateSchema,
});
export type InspectionCreateRequest = z.infer<typeof inspectionCreateSchema>;

/** PATCH — draft only. Every field optional; the items array is a sparse upsert by key. */
export const inspectionPatchSchema = z.object({
  inspectorId: z.uuid().optional(),
  inspectedOn: inspectionDateSchema.optional(),
  vehicleIdentificationMethod: vehicleIdentificationMethodSchema.optional(),
  vehicleIdentificationValue: z.string().max(60).nullish(),
  inspectionAgencyLocation: z.string().max(200).nullish(),
  /**
   * The serial on the §396.17(c)(2) decal issued with this inspection — the sticker that goes on the
   * vehicle, transcribed onto the report so the two can be matched (0281; plan §6 Q1, answered).
   *
   * Often the ONLY on-vehicle proof a §396.17 inspection happened: §396.17(c) lets a carrier carry
   * either a copy of the report or a compliant decal, and this number is what turns the sticker an
   * officer reads at a roadside into the report §396.21(b) obliges the carrier to produce.
   *
   * Optional, because a FAILED inspection gets no decal and §396.21(a)'s six contents do not include
   * one. Unique per organisation where present — one decal is one inspection.
   */
  decalSerial: z.string().max(40).nullish(),
  /** Keller's group 16 — free text, not a pass/fail component. */
  otherConditions: z.string().max(2000).nullish(),
  items: z.array(inspectionItemAnswerSchema).max(INSPECTION_ITEMS.length).optional(),
});
export type InspectionPatchRequest = z.infer<typeof inspectionPatchSchema>;

/**
 * POST /finalize. Carries no data on purpose: everything it needs is already committed, and a
 * finalize that accepted answers could certify something the inspector never saw on screen.
 */
export const inspectionFinalizeSchema = z.object({});

// ── response DTOs ────────────────────────────────────────────────────────────────────────────────

export const inspectionItemDtoSchema = z.object({
  key: z.string(),
  result: inspectionResultSchema,
  source: inspectionItemSourceSchema,
  repairedAt: z.string().nullable(),
  note: z.string().nullable(),
});
export type InspectionItemDto = z.infer<typeof inspectionItemDtoSchema>;

export const inspectionDtoSchema = z.object({
  id: z.uuid(),
  subjectType: inspectionSubjectTypeSchema,
  subjectId: z.uuid(),
  subjectUnitNumber: z.string().nullable(),
  inspectorId: z.uuid(),
  inspectorName: z.string().nullable(),
  inspectedOn: z.string(),
  nextDueOn: z.string().nullable(),
  catalogueVersion: z.string(),
  vehicleIdentificationMethod: vehicleIdentificationMethodSchema,
  vehicleIdentificationValue: z.string().nullable(),
  inspectionAgencyLocation: z.string().nullable(),
  decalSerial: z.string().nullable(),
  otherConditions: z.string().nullable(),
  status: inspectionStatusSchema,
  outcome: inspectionOutcomeSchema.nullable(),
  supersedesId: z.uuid().nullable(),
  documentId: z.uuid().nullable(),
  certificationId: z.uuid().nullable(),
  finalizedAt: z.string().nullable(),
  createdAt: z.string(),
  items: z.array(inspectionItemDtoSchema),
});
export type InspectionDto = z.infer<typeof inspectionDtoSchema>;

// ── the roster's view of an inspection (D-AVI16) ─────────────────────────────────────────────────

/**
 * How far ahead counts as "expiring" for a vehicle's annual inspection.
 *
 * One number, one place. `DQ_ALERT_THRESHOLDS` is `[90, 60, 30, 14, 0]` for driver credentials
 * because those are chased over months; equipment gets the single 30-day mark the owner asked for
 * (2026-08-31). What matters is not the number but that the vehicles page, the trailers page and
 * anything added later read it from here — "expiring" meaning two different things on two screens is
 * the failure this constant exists to prevent.
 */
export const INSPECTION_EXPIRY_WARNING_DAYS = 30;

export const INSPECTION_EXPIRY_STATES = ["valid", "expiring", "expired", "unknown"] as const;
export type InspectionExpiryState = (typeof INSPECTION_EXPIRY_STATES)[number];

export interface InspectionExpiry {
  state: InspectionExpiryState;
  /** Negative once overdue. Null when no inspection has been recorded. */
  daysRemaining: number | null;
  expiresOn: string | null;
}

/**
 * What a piece of equipment's annual inspection status is on a given day.
 *
 * `today` is a parameter and not a clock read, for the reason `buildDqFile` gives: the question an
 * auditor asks is "what did this say on the day of the incident", which a function that reads the
 * wall clock cannot answer. It also makes this testable without freezing time.
 *
 * `unknown` rather than `expired` when there is no date. An empty column means nobody has recorded
 * an inspection here — which may be a truck that arrived last week — and colouring that as overdue
 * tells the office a compliance failure it has not actually established. Missing and lapsed are
 * different facts and the roster shows them differently.
 */
export function inspectionExpiry(expiresOn: string | null | undefined, today: string): InspectionExpiry {
  if (!expiresOn) return { state: "unknown", daysRemaining: null, expiresOn: null };
  const days = daysBetween(today, expiresOn);
  if (days < 0) return { state: "expired", daysRemaining: days, expiresOn };
  if (days <= INSPECTION_EXPIRY_WARNING_DAYS) return { state: "expiring", daysRemaining: days, expiresOn };
  return { state: "valid", daysRemaining: days, expiresOn };
}

/**
 * Whole days from `from` to `to`, both `YYYY-MM-DD`. UTC midnight, so no timezone can shift it.
 *
 * ⚠ The `- 1` on the month is not decoration. `Date.UTC` takes a ZERO-indexed month, so spreading a
 * parsed date straight in reads June as July — and because both ends shift, the difference stays
 * right in most cases and goes wrong only across month boundaries of unequal length. The first
 * draft of this function had exactly that bug and every obvious test passed: 2026-01-31 to
 * 2026-02-28 came out as 25 days instead of 28.
 */
function daysBetween(from: string, to: string): number {
  const at = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}
