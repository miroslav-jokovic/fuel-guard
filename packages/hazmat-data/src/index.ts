import raw202602 from "../datasets/2026.02.json" with { type: "json" };
import raw202607 from "../datasets/2026.07.0.json" with { type: "json" };
import raw2026071 from "../datasets/2026.07.1.json" with { type: "json" };
import rawReferenceText from "../datasets/referenceText.json" with { type: "json" };
import rawInterpretations from "../datasets/interpretations.json" with { type: "json" };
import { parseDataset, type Dataset } from "./schema.js";
import { parseReferenceStore, type ReferenceStore } from "./referenceText.js";
import { parseInterpretations, type InterpretationsFile } from "./interpretations.js";

/**
 * @hazmat/data — versioned regulatory dataset + typed loader (Phase H1). Ships dataset JSON validated
 * against the schema on load. Does NOT import @hazmat/engine — the CALLER loads a dataset here and
 * passes it into the engine, so the engine stays testable with synthetic data (D3/G5). Datasets are
 * whole-file JSON loaded into memory; the DB stores only WHICH version a verdict used (D9/G6).
 */

export * from "./schema.js";
export * from "./matchRecords.js";
export * from "./resolve.js";
// Reference text (D12) is a SEPARATE export from the Dataset — display + audit only, never the engine.
export * from "./referenceText.js";
export * from "./interpretations.js";

const RAW: Readonly<Record<string, unknown>> = {
  "2026.02": raw202602,
  "2026.07.0": raw202607,
  "2026.07.1": raw2026071,
};

/** The newest published dataset — the default the API loads unless a caller pins an older version. */
export const LATEST_DATASET_VERSION = "2026.07.1";

export function listDatasetVersions(): string[] {
  return Object.keys(RAW);
}

export function loadDataset(version: string = LATEST_DATASET_VERSION): Dataset {
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

/** Load the curated PHMSA interpretation letters (H1) — provenance/display metadata for rule citations. */
export function loadInterpretations(): InterpretationsFile {
  return parseInterpretations(rawInterpretations);
}
