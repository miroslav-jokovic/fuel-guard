import { z } from "zod";
import { COMPLIANCE_DOCUMENT_KINDS } from "./complianceContract.js";
import type { FieldCriticality } from "./shippingDocumentContract.js";

/**
 * CompliancePaperBatch — the `compliance_paper` profile's contract (UNIT-FILES-PLAN UF7b2; DOCUMENT-READER-
 * PLAN D-DR1). One uploaded file — a single cab card, or a 14-page scan of a stack of registrations, medical
 * cards and annuals — read once, as a list of the papers it holds.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────────────────────────
 * Bulk upload (UF7): the office drops a pile of papers; each one becomes a row in `file_intake_items` (0505)
 * with a proposed owner (`fileSubjectMatch.ts`, from the identifiers below), a proposed kind and proposed
 * dates; a PERSON files it (D-UF8). It is also how the McLeod import's 1,359 undated papers get a proposed
 * date (Q-UF13 (b)). Nothing read here is ever written as evidence without a person accepting it.
 *
 * ── DATA AS PRINTED, WITH ONE JUDGEMENT ─────────────────────────────────────────────────────────
 * Every value is the paper's text (D-DR2): a date is the printed string, a VIN keeps every character, a
 * plate keeps its spaces. Normalising them for the matcher and the date pickers is the consumer's, in code.
 * The one value that is NOT printed is `kind` — which of our catalogue's papers this is. A paper never
 * prints "annual_inspection"; somebody has to say what it is, and the review table's first column is a
 * person checking exactly that. `title` carries what the paper itself calls itself, so the person sees the
 * reader's evidence for the judgement.
 *
 * ── WHAT IS NOT READ ────────────────────────────────────────────────────────────────────────────
 * Dates of birth, home addresses, SSNs, medical findings and drug-test results. The matcher needs a name, a
 * licence number and unit identifiers; what we do not transcribe cannot leak (D-FP2's posture, and the
 * roadside report's). A policy's schedule of insured units is read into the same `unitNumbers` / `vins`
 * lists rather than a separate one — the matcher already answers "several units" (D-UF6).
 *
 * Every field defaults to null (a list to []), so `parse({})` is the empty batch.
 */

const str = () => z.string().nullable().default(null);
const strList = () => z.array(z.string()).default([]);

/**
 * 1.1.0 (DRIVER-PAPER-INTAKE-PLAN PI3, 2026-11-06): the kind list names a paper driver file's papers, not
 * only a vehicle's and a licence, and `issuedOn` also carries the date a dated record HAPPENED (a test, a
 * review, an inquiry). A version bump is a new cache key: nothing read under 1.0.0 is reused as 1.1.0.
 */
export const COMPLIANCE_PAPER_PROFILE_VERSION = "compliance_paper-1.1.0";

export const compliancePaperSchema = z.object({
  pageFrom: z.number().int().nullable().default(null).describe("The first page of this paper in the file, counting from 1."),
  pageTo: z.number().int().nullable().default(null).describe("The last page of this paper in the file, counting from 1."),
  kind: z
    .enum(COMPLIANCE_DOCUMENT_KINDS)
    .nullable()
    .default(null)
    .describe(
      "Which paper this is. registration = a state registration card; irp = an IRP apportioned cab card; " +
        "annual_inspection = an annual / periodic vehicle inspection report; insurance = an insurance policy or " +
        "certificate; ifta = an IFTA licence; title = a vehicle title; lease = an equipment lease; " +
        "medical_card = a DOT medical examiner's certificate; cdl = a driver's licence; " +
        "employment_application = a driver's application for employment; mvr = a motor vehicle record (driving " +
        "record) printout; annual_mvr_review = an annual review of a driver's record, signed by the carrier; " +
        "road_test = a road test certificate or form; cdl_equivalency = a certificate accepting a licence in " +
        "place of a road test; previous_employer_inquiry = a carrier's request to a previous employer; " +
        "previous_employer_response = a previous employer's answer about safety performance; drug_test = a drug " +
        "test form or result; alcohol_test = an alcohol test form or result; clearinghouse_full = an FMCSA " +
        "Clearinghouse full query result; clearinghouse_limited = a Clearinghouse limited query result; " +
        "medical_registry_verification = a note that the examiner was verified on the National Registry; " +
        "eldt = an entry-level driver training certificate; psp_report = a Pre-Employment Screening Program " +
        "report. other = none of the list.",
    ),
  title: z.string().nullable().default(null).describe("The paper's own printed title or heading, as printed."),
  issuer: z.string().nullable().default(null).describe("Who issued it — the state, agency, insurer or inspector — as printed."),
  unitNumbers: strList().describe("Every unit or fleet number printed on this paper, as printed."),
  vins: strList().describe("Every vehicle identification number printed on this paper, every character as printed."),
  plates: z
    .array(z.object({ number: z.string().describe("The plate number as printed."), state: str().describe("The plate's state, if printed.") }))
    .default([])
    .describe("Every licence plate printed on this paper."),
  driverName: z.string().nullable().default(null).describe("The person the paper is about, as printed — null for a vehicle's paper."),
  licenseNumber: z.string().nullable().default(null).describe("That person's driver's licence number, every character as printed."),
  issuedOn: z
    .string()
    .nullable()
    .default(null)
    .describe("The date the paper was issued, signed, or the thing it records happened (an inspection, a test, a review), exactly as printed."),
  expiresOn: z.string().nullable().default(null).describe("The date the paper expires or is valid until, exactly as printed."),
});
export type CompliancePaper = z.infer<typeof compliancePaperSchema>;

export const compliancePaperBatchSchema = z.object({
  papers: z.array(compliancePaperSchema).default([]).describe("Each separate paper in the file, in page order."),
});
export type CompliancePaperBatch = z.infer<typeof compliancePaperBatchSchema>;

export const emptyCompliancePaperBatch = (): CompliancePaperBatch => compliancePaperBatchSchema.parse({});

/**
 * The fields a filing decides on: whose paper it is, what it is, and until when it is good. A wrong one
 * files a paper on the wrong unit or makes an expired one look current, so they graduate at the engine's bar.
 */
const DECIDING_PATHS = [
  /^papers\[\d+\]\.kind$/,
  /^papers\[\d+\]\.vins$/,
  /^papers\[\d+\]\.plates\[\d+\]\.number$/,
  /^papers\[\d+\]\.unitNumbers$/,
  /^papers\[\d+\]\.licenseNumber$/,
  /^papers\[\d+\]\.expiresOn$/,
];
export function compliancePaperFieldCriticality(path: string): FieldCriticality {
  return DECIDING_PATHS.some((rx) => rx.test(path)) ? "engine" : "standard";
}
