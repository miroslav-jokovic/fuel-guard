import type { Env } from "../../../env.js";

/**
 * The reader's two model pins (D-DR8). Pass A is `DOC_READ_MODEL_A`, locked by its own default to Sonnet
 * 4.6 (D-DR20, owner 2026-10-11) — it no longer falls through to `HAZMAT_MODEL_A`, so the hazmat
 * extractor's pin cannot move the reader. Pass B is `DOC_READ_MODEL_B`, falling back to `HAZMAT_MODEL_B`
 * (Haiku 4.5) until Q-DR23 picks the second reader.
 */
export interface ReadModels {
  A: string;
  B: string;
}

export function readModels(
  env: Pick<Env, "DOC_READ_MODEL_A" | "DOC_READ_MODEL_B" | "HAZMAT_MODEL_A" | "HAZMAT_MODEL_B">,
): ReadModels {
  return { A: env.DOC_READ_MODEL_A, B: env.DOC_READ_MODEL_B ?? env.HAZMAT_MODEL_B };
}
