import { z } from "zod";
import type { FieldCriticality } from "./shippingDocumentContract.js";

/**
 * MvrReport — the `mvr_report` profile's contract (HIRING-WORKFLOW-AUDIT §14, OF6; DOCUMENT-READER-PLAN
 * D-DR1). One motor vehicle record, as a state or SambaSafety prints it, read once into what a recruiter
 * checks before hiring: whose licence, its status and class, the medical certification the state holds,
 * and every violation, crash and suspension on it.
 *
 * ── WHAT IT IS FOR (owner, 2026-11-03) ──────────────────────────────────────────────────────────
 * *"For checking PSP, MVR we will read them and our AI … we will use AI as checking layer."* The office
 * pulls the MVR in SambaSafety's portal (D-OF8) and drops the PDF on the driving-record drawer; the reader
 * proposes these fields, `mvrReportFindings` turns them into the questions a recruiter must answer, and a
 * PERSON records the MVR. Nothing read here is filed without somebody confirming it — the profile has ONE
 * reader (`readers: 1`), and its second witness is the recruiter, `compliance_paper`'s rule (D-UF8).
 *
 * ── DATA AS PRINTED ─────────────────────────────────────────────────────────────────────────────
 * Every value is the record's text (D-DR2): a date is the printed string, a status is the state's word.
 * Turning "SUSP" or "VALID" into a verdict is `mvrReportFindings`', in code, where a test can pin it.
 *
 * ── WHAT IS NOT READ ────────────────────────────────────────────────────────────────────────────
 * Dates of birth, home addresses, SSNs, height, weight and eye colour. A match needs the name, the licence
 * number and its state; what we do not transcribe cannot leak (the roadside report's and compliance
 * paper's posture).
 *
 * Every field defaults to null (a list to []), so `parse({})` is the empty report.
 */

const str = (what: string) => z.string().nullable().default(null).describe(what);

export const MVR_REPORT_PROFILE_VERSION = "mvr_report-1.0.0";

const eventSchema = z.object({
  date: str("The date of the event (the violation, the conviction or the crash), exactly as printed."),
  description: str("What the record says happened, as printed — the violation or the crash description."),
  code: str("The violation or ACD code, if printed."),
  points: str("Points assessed, as printed."),
  commercialVehicle: str("Whether the record marks it as in a commercial motor vehicle (CMV), as printed."),
});

export const mvrReportSchema = z.object({
  reportDate: str("The date the record was produced or ordered, exactly as printed."),
  issuer: str("Who produced the record — the state's agency, or SambaSafety — as printed."),
  driverName: str("The licence holder's name, as printed."),
  licenseNumber: str("The driver's licence number, every character as printed."),
  licenseState: str("The state or jurisdiction that issued the licence, as printed."),
  licenseClass: str("The licence class (A, B, C …), as printed."),
  licenseStatus: str("The licence status as printed — for example VALID, ACTIVE, SUSPENDED, REVOKED, EXPIRED."),
  commercialStatus: str("The commercial (CDL) privilege status if printed separately, as printed."),
  licenseExpires: str("The licence expiry date, exactly as printed."),
  endorsements: z.array(z.string()).default([]).describe("Every endorsement code or word printed (H, N, T, X …)."),
  restrictions: z.array(z.string()).default([]).describe("Every restriction code or word printed."),
  medicalCertificationStatus: str("The medical certification status the state holds, as printed — for example CERTIFIED, NOT CERTIFIED."),
  medicalSelfCertification: str("The self-certification category, as printed — NI, EI, NA or EA (or the words)."),
  medicalExpires: str("The medical certificate's expiry date the state holds, exactly as printed."),
  violations: z.array(eventSchema).default([]).describe("Every violation or conviction on the record, in the order printed."),
  accidents: z.array(eventSchema).default([]).describe("Every crash or accident on the record, in the order printed."),
  withdrawals: z
    .array(
      z.object({
        from: str("When the suspension, revocation, cancellation or disqualification began, as printed."),
        to: str("When it ended or ends, as printed — null if no end is printed."),
        kind: str("What it is, as printed — suspension, revocation, cancellation, disqualification."),
        reason: str("The reason printed."),
      }),
    )
    .default([])
    .describe("Every suspension, revocation, cancellation or disqualification on the record, in the order printed."),
  noRecordFound: z
    .boolean()
    .nullable()
    .default(null)
    .describe("True only when the record says plainly that no record was found for the request."),
});
export type MvrReport = z.infer<typeof mvrReportSchema>;

export const emptyMvrReport = (): MvrReport => mvrReportSchema.parse({});

/** What a hiring decision rests on — a wrong one hires on a licence that is not good. Read at the engine's bar. */
const DECIDING_PATHS = [
  /^licenseNumber$/,
  /^licenseState$/,
  /^licenseStatus$/,
  /^commercialStatus$/,
  /^licenseClass$/,
  /^licenseExpires$/,
  /^medicalCertificationStatus$/,
  /^medicalExpires$/,
  /^withdrawals\[\d+\]\.(from|to|kind)$/,
];
export function mvrReportFieldCriticality(path: string): FieldCriticality {
  return DECIDING_PATHS.some((rx) => rx.test(path)) ? "engine" : "standard";
}
