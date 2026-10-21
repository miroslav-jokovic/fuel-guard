import type { CompliancePaperBatch, FieldEvidence } from "@silvicom/shared";
import { positionalEvidence } from "./positionalEvidence.js";
import type { OcrPage } from "./rowWitness.js";

/**
 * A pile of papers' evidence (UNIT-FILES-PLAN UF7b2): `positionalEvidence`'s rule with ONE reader — the
 * papers are in page order, and the profile is read once (`readers: 1`, D-UF8).
 *
 * The OCR witness is asked about the identifiers the matcher files a paper on (`fileSubjectMatch.ts`: VIN,
 * then plate, then unit number, then licence number) and the expiry the item's verdict reads. With one
 * model reading, "the page's own characters print this" is the only check besides the person's, so the
 * review table can say which values the page backs before anyone files one. `vins` and `unitNumbers` are
 * each ONE field, a list (`leafFieldPaths` stops at a list of strings), backed when every entry is printed.
 * A unit number is usually shorter than the witness's five-character floor, so it is seldom backed — the
 * matcher ranks it below a VIN and a plate for the same reason.
 */
const DECIDING = [
  /^papers\[\d+\]\.vins$/,
  /^papers\[\d+\]\.plates\[\d+\]\.number$/,
  /^papers\[\d+\]\.unitNumbers$/,
  /^papers\[\d+\]\.licenseNumber$/,
  /^papers\[\d+\]\.expiresOn$/,
];

type Doc = Partial<CompliancePaperBatch>;

export function compliancePaperEvidence(
  a: Doc,
  b: Doc | null,
  ruleVersion: string,
  ocr: readonly OcrPage[] | null = null,
  textLayer: readonly OcrPage[] | null = null,
): FieldEvidence[] {
  return positionalEvidence({ deciding: DECIDING, readers: 1 }, a, b, ruleVersion, ocr, textLayer);
}
