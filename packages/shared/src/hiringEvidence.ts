import { z } from "zod";
import { hiringStep, type HiringStepKey } from "./hiringSteps.js";
import type { QualificationRecordKind } from "./complianceContract.js";

/**
 * Recording the acts nobody can perform from inside this product — D1, D-HM6.
 *
 * ── WHAT D-HM6 ACTUALLY RULED, AND WHY IT IS A BUILD RATHER THAN A DEFERRAL ───────────────────
 * *"Neither can be performed from this product today: the Clearinghouse query is made in FMCSA's
 * portal and requires the carrier's own plan purchase plus IDEMIA identity verification, and there
 * is no MVR vendor at all. Record the act and file the artifact; do not model an integration that
 * nobody can call. A recorded act is a real DQF row; a disabled integration is a lie on a screen."*
 * Q-HM2 then closed the MVR question for good — the carrier pulls records from SambaSafety outside
 * Silvicom 360 and will not be reaching it from here — so the upload IS the feature, permanently,
 * not a placeholder for an integration that arrives later.
 *
 * ── WHY THIS IS NOT `POST /api/compliance/documents` PLUS `POST /qualification-records` ───────
 * Those two doors exist and do exactly this work, and `pspImport.ts` already refused them for
 * reasons that apply here unchanged:
 *
 *   1. **They are gated on the ROSTER section, which a recruiter does not manage.** `recruiter` is
 *      `roster: "view"` by RECRUITER-ROLE-SCOPE.md's Option B, deliberately, so that the one write
 *      they genuinely need is granted BY NAME rather than by widening a section — the matrix says
 *      so in its own comment. The consequence measured on 2026-09-19: a recruiter working the
 *      hiring checklist could not perform step 5, and the board's lead action is literally *"Next:
 *      order the MVR"*. Moving the affordance to a page the recruiter can reach, or widening
 *      `roster` to fit, are the two shapes `CLAUDE.md`'s *no workarounds* section names.
 *   2. **The kind must be composed server-side.** `clearinghouse_full` and `drug_test` are
 *      `TESTING_RECORD_KINDS` — the kind IS the §382.401(a) read restriction — so a door that let a
 *      caller name the kind would let a drug-test result be filed as something anybody may open.
 *      Here the kind comes from the STEP, and the step comes from D-HM9's catalogue.
 *
 * ── AND WHY THE STEP LIST IS WRITTEN DOWN RATHER THAN DERIVED ─────────────────────────────────
 * ⚠ The tempting derivation is *"every step whose evidence is a `qualification_records` kind"*, and
 * it is wrong in a way that would have shipped: it includes `psp_report`, which has its own door
 * with a consent attestation and a provenance `detail` (D-PSP9), and this one has neither. A rule
 * with an exception carved out of it is a restatement wearing a derivation's clothes. So the three
 * are listed, each absence is accounted for below, and a test asserts every member resolves to a
 * real kind — which is the half that actually drifts.
 */

/**
 * The steps D1 makes recordable here, and why the other qualification-backed steps are not.
 *
 * - `psp` — its own door (`/psp-imports`, D-PSP9): an attestation that written consent existed
 *   before the pull, and a `detail` that says whether anything machine-read the report. Neither is
 *   expressible through a generic upload, and filing a PSP report without them produces a row that
 *   claims less than the law wants and more than anybody checked.
 * - `road_test` — **D2**, and it is a different act: §391.31(c)'s eight-item form and an examiner,
 *   producing the §391.31(e) certificate. An upload box would be the wrong instrument for a test
 *   somebody performs in a yard.
 * - `medical_certificate` — **blocked on Q-HM11** (§8, opened 2026-09-19). D-HM9 makes the registry
 *   verification a federal gate for every driver; `dqCatalogue`'s `medical_registry_verification`
 *   item carries
 *   `appliesWhen: "no_cdl"`, because §391.51(b)(8)(ii)'s CDL-holder variant sunset on 2025-06-22.
 *   Those two cannot both be right, and the answer is a reading of the regulation rather than a
 *   line of code. Recording it here would pick one silently.
 * - `orientation_videos`, `live_orientation`, `handbook` — no evidence table at all (D3, D4).
 */
export const HIRING_RECORDED_ACT_STEPS = ["mvr", "clearinghouse", "drug_test"] as const;
export type HiringRecordedActStep = (typeof HIRING_RECORDED_ACT_STEPS)[number];

const RECORDED_ACT_SET: ReadonlySet<string> = new Set(HIRING_RECORDED_ACT_STEPS);

export const isHiringRecordedActStep = (key: string): key is HiringRecordedActStep =>
  RECORDED_ACT_SET.has(key);

const RECORD_TABLE_PREFIX = "qualification_records.";

/**
 * Which `qualification_records.kind` proves a step — READ OFF the catalogue, never listed beside it.
 *
 * `HiringEvidence.table` is already `"qualification_records.mvr"`: the kind is the suffix, so the
 * mapping a caller needs is a fact `hiringSteps.ts` has carried since B5 rather than a second table
 * to keep in step with it. A `Record<HiringStepKey, QualificationRecordKind>` here would be the copy
 * with a delay fuse `CLAUDE.md` describes — right on the day it was written, and silently wrong the
 * first time a step's evidence moved.
 *
 * Null for a step proved by something that is not a qualification record (the invitation, the
 * authorizations, the packet marks) or by nothing at all.
 */
export function hiringEvidenceKind(key: HiringStepKey): QualificationRecordKind | null {
  const table = hiringStep(key).evidence?.table;
  if (!table || !table.startsWith(RECORD_TABLE_PREFIX)) return null;
  return table.slice(RECORD_TABLE_PREFIX.length) as QualificationRecordKind;
}

/**
 * The kind this door may file for a step, or null when the step is not one of D1's three.
 *
 * ⚠ Both halves matter and the API asks this ONE question rather than the two separately: a step
 * outside the list must be refused even though its kind resolves (`psp`, `road_test`), and a step
 * inside the list whose evidence somehow does not resolve must be refused rather than defaulted.
 */
export function hiringRecordedActKind(key: string): QualificationRecordKind | null {
  if (!isHiringRecordedActStep(key)) return null;
  return hiringEvidenceKind(key);
}

/**
 * The `SCREENING_PREREQUISITES` call each recorded act IS — or null when nothing we hold gates it.
 *
 * ── WHY THE MVR DOOR WAS OPEN, AND WHY THIS IS A TOTAL RECORD ─────────────────────────────────
 * `SCREENING_PREREQUISITES.mvr_order` has said since A4 that ordering an MVR needs the FCRA
 * disclosure, and until 2026-09-24 nothing asked it: `pspOrder.ts` was `missingAuthorizations`'
 * only caller, so an MVR could be recorded against somebody who had signed nothing
 * (`APPLICANT-FLOW-PLAN.md` §2.5, AF1). ⚠ A `Record` over every recorded step rather than a lookup
 * with a default, so the next step added to `HIRING_RECORDED_ACT_STEPS` does not compile until
 * somebody has said what makes recording it lawful.
 *
 * - `clearinghouse` — null. The pre-employment FULL query's consent is given in FMCSA's portal and
 *   the carrier never holds it; the limited-query consent on the applicant's path authorises a
 *   different query (§382.703(a)) and would gate this one on the wrong signature.
 * - `drug_test` — null, although `drug_alcohol` is the Part 382 testing consent. `mvr_order` gates
 *   ORDERING a consumer report, which is the act FCRA makes conditional; this door records a lab
 *   result that already exists, and a refusal here would keep a result — a positive one included —
 *   out of the file for want of a signature, which protects nobody and hides a §382.301 fact.
 */
export const HIRING_RECORDED_ACT_PREREQUISITE: Readonly<Record<HiringRecordedActStep, string | null>> = {
  mvr: "mvr_order",
  clearinghouse: null,
  drug_test: null,
};

/**
 * Step one — register the scan and get somewhere to PUT it.
 *
 * No `kind` field, for `pspImportUploadSchema`'s reason: the route composes it from the step. The id
 * is client-generated so a retry after a dropped response replays rather than registering a second
 * copy of the same PDF.
 */
export const hiringEvidenceUploadSchema = z.object({
  document_id: z.uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters"),
  bytes: z.number().int().positive().nullish(),
  /** PDFs and photographs — the same set `DOCUMENT_CONTENT_TYPES` admits, checked by the route. */
  content_type: z.string().min(1),
});
export type HiringEvidenceUpload = z.infer<typeof hiringEvidenceUploadSchema>;

/**
 * Step two — file the act as a `qualification_records` row, which is what makes it evidence.
 *
 * ⚠ `document_id` is optional and that is deliberate rather than lax. §391.23(a)(1) wants the record
 * obtained, and an office that ran the Clearinghouse query at 08:00 and has not yet saved the
 * printout should be able to say so — the alternative is an office that records nothing until the
 * PDF is to hand, which is how a gate goes green days after it was actually cleared. The scan is
 * attachable afterwards from the driver's file, exactly as `RequirementDrawer` says.
 */
export const hiringEvidenceFileSchema = z.object({
  /** The date the act happened — the date on the record itself, not the day it was typed in. */
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  document_id: z.uuid().nullish(),
  /** What came back, in the operator's words. Never invented, never defaulted. */
  result: z.string().max(200).nullish(),
  /** The agency, the lab or the person who performed it. */
  performed_by: z.string().max(200).nullish(),
  /** A confirmation or report number, when the source gives one. */
  reference: z.string().max(200).nullish(),
  /**
   * The state or licensing authority an MVR came from, as the application names it (AF7,
   * §391.23(a)(1)). Written into `detail.jurisdiction` for an MVR only; `mvrJurisdictions.ts` says
   * why it is compared after trim and case and nothing more.
   *
   * ⚠ Optional at the door because a client that predates AF7 still files, and an MVR with no
   * jurisdiction is still a record that was obtained. It just covers no declared licence, so the
   * step stays open and names what is missing. The office's form asks for it.
   */
  jurisdiction: z.string().max(60).nullish(),
});
export type HiringEvidenceFiling = z.infer<typeof hiringEvidenceFileSchema>;

/**
 * A typo floor. **Not a regulation** — say so plainly, because a date bound on a compliance record
 * reads like one.
 *
 * The PSP path bounds its date at `PSP_PROGRAM_START` because the programme genuinely did not exist
 * before 2010, and none of these three has an equivalent: drug testing predates this product by
 * thirty years and a driving record has no start date at all. What they share with PSP is the real
 * hazard — the date is hand-typed off a printout, and `2011-03-04` mistyped as `1011-03-04` is a
 * date Postgres accepts without complaint and a §391.51 file then dates its own evidence to the 11th
 * century. So the floor is a digit-slip guard set well below anything a carrier files, and nothing
 * is inferred from it.
 */
export const HIRING_EVIDENCE_EARLIEST = "1990-01-01";

export interface HiringEvidenceIssue {
  field: string;
  message: string;
}

/**
 * The rules a hand-typed date has to survive. Pure arithmetic on strings — no clock, no schema.
 *
 * ⚠ The future check is the one that matters, and it is about evidence rather than tidiness:
 * §382.301(a) wants a VERIFIED NEGATIVE before a driver performs a safety-sensitive function, and a
 * record dated tomorrow asserts a result nobody has yet received. `today` is passed in for
 * `buildDqFile`'s reason — a function that read the wall clock could only be tested at a particular
 * hour.
 */
export function validateHiringEvidence(
  input: HiringEvidenceFiling,
  today: string,
): HiringEvidenceIssue[] {
  const issues: HiringEvidenceIssue[] = [];
  if (input.occurred_on > today) {
    issues.push({ field: "occurred_on", message: "That date is in the future." });
  }
  if (input.occurred_on < HIRING_EVIDENCE_EARLIEST) {
    issues.push({ field: "occurred_on", message: "That date looks mistyped — check the year." });
  }
  return issues;
}

/** `qualification_records.detail` for a recorded act. */
export const HIRING_EVIDENCE_SOURCE = "recorded_act";

/**
 * What a later reader needs to know about where this row came from.
 *
 * ⚠ It records the PROVENANCE and claims nothing about the content, on `PSP_IMPORT_RESULT`'s
 * argument: nothing here machine-read anything, so a `result` is whatever the operator typed off a
 * printout and must not be dressed up as a computed verdict. `source: "recorded_act"` is what tells
 * a reader in 2029 that this MVR was pulled somewhere else and typed in — which is D-HM6's whole
 * ruling, written onto the row rather than into a document nobody will find.
 */
export function hiringEvidenceDetail(
  step: HiringRecordedActStep,
  recordedBy: string,
  jurisdiction?: string | null,
): Record<string, unknown> {
  // ⚠ An MVR's only. A drug test or a Clearinghouse query has no licensing jurisdiction, and a key
  // on those rows would be a fact nobody was asked for, sitting where a later reader would trust it.
  const where = step === "mvr" ? jurisdiction?.trim() : undefined;
  return {
    source: HIRING_EVIDENCE_SOURCE,
    structured: false,
    hiring_step: step,
    recorded_by: recordedBy,
    ...(where ? { jurisdiction: where } : {}),
  };
}
