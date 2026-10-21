import type { FieldEvidence, RoadsideInspectionReport } from "@silvicom/shared";
import { positionalEvidence } from "./positionalEvidence.js";
import type { OcrPage } from "./rowWitness.js";

/**
 * An officer's report's evidence (INSPECTION-CHALLENGE-PLAN D-IC13; DOCUMENT-READER-PLAN §7B, D-DR19):
 * for every field, what each witness said — `positionalEvidence`'s rule, two readers, a report printing its
 * units and violations in numbered rows.
 *
 * The OCR witness is asked about three fields — report number, licence number, VIN — because they are
 * what confirms a driver (Q-IC11 (a), owner 2026-10-15). A licence two readers agree on AND the page's own
 * characters print is the strongest reading this pipeline can make; a name is compared but never
 * confirms, so it does not need the witness.
 */
const DECIDING = [/^reportNumber$/, /^driver\.licenseNumber$/, /^units\[\d+\]\.vin$/];

type Doc = Partial<RoadsideInspectionReport>;

export function roadsideReportEvidence(
  a: Doc,
  b: Doc | null,
  ruleVersion: string,
  ocr: readonly OcrPage[] | null = null,
  textLayer: readonly OcrPage[] | null = null,
): FieldEvidence[] {
  return positionalEvidence({ deciding: DECIDING, readers: 2 }, a, b, ruleVersion, ocr, textLayer);
}
