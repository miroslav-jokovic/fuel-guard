import raw202602 from "../datasets/2026.02.json" with { type: "json" };
import raw202607 from "../datasets/2026.07.0.json" with { type: "json" };
import raw2026071 from "../datasets/2026.07.1.json" with { type: "json" };
import raw2026080 from "../datasets/2026.08.0.json" with { type: "json" };
import raw2026100 from "../datasets/2026.10.0.json" with { type: "json" };
import raw2026120 from "../datasets/2026.12.0.json" with { type: "json" };
import rawReferenceText from "../datasets/referenceText.json" with { type: "json" };
import rawInterpretations from "../datasets/interpretations.json" with { type: "json" };
import rawCitations from "../datasets/citations.json" with { type: "json" };
import { parseDataset, type Dataset } from "./schema.js";
import { withSubsidiaryClasses } from "./subsidiaryClasses.js";
import { parseReferenceStore, type ReferenceStore } from "./referenceText.js";
import { parseInterpretations, type InterpretationsFile } from "./interpretations.js";
import { citationListSchema, type CitationList } from "./citations.js";

/**
 * @hazmat/data — versioned regulatory dataset + typed loader (Phase H1). Ships dataset JSON validated
 * against the schema on load. Does NOT import @hazmat/engine — the CALLER loads a dataset here and
 * passes it into the engine, so the engine stays testable with synthetic data (D3/G5). Datasets are
 * whole-file JSON loaded into memory; the DB stores only WHICH version a verdict used (D9/G6).
 */

export * from "./schema.js";
export * from "./matchRecords.js";
export * from "./resolve.js";
export * from "./resolveLine.js";
export * from "./subsidiaryClasses.js";
export * from "./securityPlan.js";
export * from "./safetyPermit.js";
// Reference text (D12) is a SEPARATE export from the Dataset — display + audit only, never the engine.
export * from "./referenceText.js";
export * from "./interpretations.js";
// The verified citation list (TC0.5) — evidence ABOUT the engine, never read by it.
export * from "./citations.js";

const RAW: Readonly<Record<string, unknown>> = {
  "2026.02": raw202602,
  "2026.07.0": raw202607,
  "2026.07.1": raw2026071,
  // 2026.08.0 (H-LQ groundwork): same captured sources as 2026.07.1, parser now carries columns
  // 8A (exceptionsRef — the §173.150ff LQ trigger) and 8B (nonBulkPackagingRef). Triangulation ALL
  // CLEAN; ships PROVISIONAL because it was never human-attested. Its attested re-cut is no longer
  // possible from the committed fixtures: Q-DR14a was ruled (b) on 2026-10-14 and Title 49 was
  // recaptured at 2026-10-09, so the attestable cuts are the newer ones (PROMOTION-CHECKLIST.md).
  // LATEST deliberately stays 2026.07.1 until an attested file is in, so no production load
  // regresses to a provisional dataset.
  "2026.08.0": raw2026080,
  // 2026.10.0 and 2026.12.0 (Q-DR14a ruled (b), 2026-10-14): cut from eCFR 2026-10-09, triangulation
  // ALL CLEAN with 91 FR 51098's four fireworks-row differences explained by citation
  // (import/reconciliations.ts). Both carry column 8A and the namesChemicalGroup flag (Q-DR17).
  // 2026.10.0 reads hazSubstances from §172.101 Appendix A; 2026.12.0 is the same text with Table 302.4
  // instead, because 91 FR 49305 makes Appendix A a pointer to 40 CFR 302.4 on 2026-12-02. Both ship
  // PROVISIONAL until a named person attests (datasets/2026.10.0/PROMOTION-CHECKLIST.md); LATEST moves to
  // 2026.10.0 on attestation and to 2026.12.0 no earlier than 2026-12-02.
  "2026.10.0": raw2026100,
  "2026.12.0": raw2026120,
};

/** The newest published dataset — the default the API loads unless a caller pins an older version. */
export const LATEST_DATASET_VERSION = "2026.07.1";

export function listDatasetVersions(): string[] {
  return Object.keys(RAW);
}

export function loadDataset(version: string = LATEST_DATASET_VERSION): Dataset {
  // D-PC1: the cuts shipped before 2026-10-26 carry label codes per row and an empty subsidiaryClasses on
  // every entry; the field is derived here so no cut has to be re-minted to carry it (subsidiaryClasses.ts).
  return withSubsidiaryClasses(loadDatasetAsCut(version));
}

/**
 * The cut's file exactly as it was minted — validated, nothing derived. The content checksum attests THIS
 * (`import/buildDataset.ts` `verifyChecksum`); `loadDataset()` is what every consumer reads.
 */
export function loadDatasetAsCut(version: string = LATEST_DATASET_VERSION): Dataset {
  const raw = RAW[version];
  if (!raw) {
    throw new Error(
      `Unknown hazmat dataset version "${version}". Available: ${listDatasetVersions().join(", ")}`,
    );
  }
  return parseDataset(raw);
}

/**
 * Load the CFR reference-text store (D12) — the citation-keyed display text for "read the rule behind
 * this finding" and the audit chain. Populated by import/referenceTextBuild.ts; provisional until then.
 * Intentionally separate from loadDataset(): the engine never receives this.
 */
export function loadReferenceText(): ReferenceStore {
  return parseReferenceStore(rawReferenceText);
}

/** Load the verified citation list (TWO-CLICK-READER-PLAN TC0.5): every `cfr` the engine emits, checked against eCFR. */
export function loadCitations(): CitationList {
  return citationListSchema.parse(rawCitations);
}

/** Load the curated PHMSA interpretation letters (H1) — provenance/display metadata for rule citations. */
export function loadInterpretations(): InterpretationsFile {
  return parseInterpretations(rawInterpretations);
}
