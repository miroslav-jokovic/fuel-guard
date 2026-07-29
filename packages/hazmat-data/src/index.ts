import raw202602 from "../datasets/2026.02.json" with { type: "json" };
import { parseDataset, type Dataset } from "./schema.js";

/**
 * @hazmat/data — versioned regulatory dataset + typed loader (Phase H1). Ships dataset JSON validated
 * against the schema on load. Does NOT import @hazmat/engine — the CALLER loads a dataset here and
 * passes it into the engine, so the engine stays testable with synthetic data (D3/G5). Datasets are
 * whole-file JSON loaded into memory; the DB stores only WHICH version a verdict used (D9/G6).
 */

export * from "./schema.js";
export * from "./matchRecords.js";
export * from "./resolve.js";

const RAW: Readonly<Record<string, unknown>> = {
  "2026.02": raw202602,
};

/** The newest published dataset — the default the API loads unless a caller pins an older version. */
export const LATEST_DATASET_VERSION = "2026.02";

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
