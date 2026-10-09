import type { Env } from "../../../env.js";

/**
 * The reader's two model pins (D-DR8). `DOC_READ_MODEL_A` / `_B` win; unset, each falls back to the
 * hazmat extractor's pin (`HAZMAT_MODEL_A` / `_B`, envDocumentReading.ts), which keeps its default —
 * Sonnet 4.6 for pass A, Haiku 4.5 for pass B — so introducing the reader moves no model anywhere.
 * Which pair to run is §8's measurement and the owner's pick (Q-DR1), not this file's.
 */
export interface ReadModels {
  A: string;
  B: string;
}

export function readModels(
  env: Pick<Env, "DOC_READ_MODEL_A" | "DOC_READ_MODEL_B" | "HAZMAT_MODEL_A" | "HAZMAT_MODEL_B">,
): ReadModels {
  return { A: env.DOC_READ_MODEL_A ?? env.HAZMAT_MODEL_A, B: env.DOC_READ_MODEL_B ?? env.HAZMAT_MODEL_B };
}
