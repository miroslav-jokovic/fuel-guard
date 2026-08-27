import { evaluateLoad, type LoadInput } from "@hazmat/engine";
import { loadDataset, LATEST_DATASET_VERSION, listDatasetVersions } from "@hazmat/data";
import { PLACARD_ART_VERSION } from "@hazmat/placards";
import type { HazmatCalcRequest, HazmatCalcResponse } from "@silvicom/shared";

/**
 * Deterministic placard/eligibility calculation (plan H5) — the pure engine call shared by the
 * authenticated calculator (`/api/hazmat/calc`) and the public M7 calculator (`/api/public/hazmat/calc`).
 * No AI, no persistence, no org/PII context: a LoadInput in, a verdict with CFR citations out. The
 * placards it returns are SPECIMENS (`placardArtVersion` provisional until M10) — callers label them so.
 */
export type CalcError = { code: string; message: string };

export function computeCalc(body: HazmatCalcRequest): HazmatCalcResponse | CalcError {
  const version = body.datasetVersion ?? LATEST_DATASET_VERSION;
  if (body.datasetVersion && !listDatasetVersions().includes(version)) {
    return { code: "unknown_dataset", message: `Unknown hazmat dataset version "${version}".` };
  }
  const dataset = loadDataset(version);
  const input = {
    evaluatedAt: new Date().toISOString(),
    ...(body.load as Record<string, unknown>),
    dataset,
  } as unknown as LoadInput;

  let verdict;
  try {
    verdict = evaluateLoad(input);
  } catch (e) {
    return { code: "invalid_load", message: e instanceof Error ? e.message : "Invalid load input" };
  }

  return {
    engineVersion: verdict.engineVersion,
    datasetVersion: dataset.version,
    datasetProvisional: dataset.provisional,
    placardArtVersion: PLACARD_ART_VERSION,
    verdict,
  };
}
