import type { FieldEvidence, MvrReport } from "@silvicom/shared";
import { positionalEvidence } from "./positionalEvidence.js";
import type { OcrPage } from "./rowWitness.js";

/**
 * A motor vehicle record's evidence (HIRING-WORKFLOW-AUDIT §14, OF6): `positionalEvidence`'s rule with ONE
 * reader, `compliance_paper`'s — the recruiter is the second witness. The OCR witness is asked about the values
 * a hiring decision rests on: whose licence it is, its status and expiry, and the medical certification, so the
 * review can say which of them the page's own characters back before anybody records the MVR.
 */
const DECIDING = [
  /^licenseNumber$/,
  /^licenseStatus$/,
  /^commercialStatus$/,
  /^licenseExpires$/,
  /^medicalCertificationStatus$/,
  /^medicalExpires$/,
];

type Doc = Partial<MvrReport>;

export function mvrReportEvidence(
  a: Doc,
  b: Doc | null,
  ruleVersion: string,
  ocr: readonly OcrPage[] | null = null,
  textLayer: readonly OcrPage[] | null = null,
): FieldEvidence[] {
  return positionalEvidence({ deciding: DECIDING, readers: 1 }, a, b, ruleVersion, ocr, textLayer);
}
