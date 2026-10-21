import type { DocumentProfileId } from "@silvicom/shared";
import { DOCUMENT_PROFILES } from "@silvicom/shared";
import type { Env } from "../../../env.js";

/**
 * The reader's model pins (D-DR8). Pass A is `DOC_READ_MODEL_A`, locked by its own default to Sonnet
 * 4.6 (D-DR20, owner 2026-10-11) — it no longer falls through to `HAZMAT_MODEL_A`, so the hazmat
 * extractor's pin cannot move the reader. Pass B is `DOC_READ_MODEL_B`, locked the same way to Sonnet 5.5
 * (Q-DR23, owner 2026-10-11).
 *
 * A one-reader profile (`readers: 1`, UNIT-FILES-PLAN UF7b2) has no pass B: its one reader is
 * `DOC_FILE_READ_MODEL`, and `B` is null. The models a read records — and its cache key — are then that
 * one id, so a one-reader read can never replay a two-reader read's answer or the other way round.
 */
export interface ReadModels {
  A: string;
  B: string | null;
}

export function readModels(
  env: Pick<Env, "DOC_READ_MODEL_A" | "DOC_READ_MODEL_B" | "DOC_FILE_READ_MODEL">,
  profile: DocumentProfileId,
): ReadModels {
  if ("readers" in DOCUMENT_PROFILES[profile] && DOCUMENT_PROFILES[profile].readers === 1) return { A: env.DOC_FILE_READ_MODEL, B: null };
  return { A: env.DOC_READ_MODEL_A, B: env.DOC_READ_MODEL_B };
}
