import dataset202602 from "../datasets/2026.02.json" with { type: "json" };

/**
 * @hazmat/data — the versioned regulatory dataset for HazmatGuard (Phase H0 skeleton).
 *
 * Ships the dataset JSON + a typed loader. It deliberately does NOT import @hazmat/engine: the CALLER
 * loads a dataset here and passes it into the engine, so the engine stays testable with synthetic data
 * and the dataset updates without touching engine code. Regulatory updates are human-reviewed, versioned
 * releases with an effective date (D9); every verdict records the dataset version it used.
 */

export interface HazmatDataset {
  version: string;
  /** ISO date the regulatory text takes effect. */
  effectiveDate?: string;
  note?: string;
  readonly entries: readonly unknown[];
}

const DATASETS: Readonly<Record<string, HazmatDataset>> = {
  "2026.02": dataset202602 as HazmatDataset,
};

/** The newest published dataset — the default the API loads unless a caller pins an older version. */
export const LATEST_DATASET_VERSION = "2026.02";

export function listDatasetVersions(): string[] {
  return Object.keys(DATASETS);
}

export function loadDataset(version: string = LATEST_DATASET_VERSION): HazmatDataset {
  const ds = DATASETS[version];
  if (!ds) {
    throw new Error(
      `Unknown hazmat dataset version "${version}". Available: ${listDatasetVersions().join(", ")}`,
    );
  }
  return ds;
}
