import { z } from "zod";

/**
 * The document-reading programme's environment (`docs/plans/document-reading/DOCUMENT-READER-PLAN.md`),
 * lifted out of `env.ts` on the `envEfs.ts` precedent: one plan, one group of variables, a natural
 * boundary, and `env.ts` was at its 500-line budget when the first of them arrived. Spread into the one
 * schema, so a deployment still gets one parse and one error listing everything it is missing.
 *
 * Today it holds the hazmat extractor's two model pins — the reader's models by D-DR8, moved here
 * unchanged — and the Samsara documents collector's two knobs (Step 0.1). The reader's own pins
 * (`DOC_READ_MODEL_A` / `_B`) and its intake settings land here as their steps do.
 */
export const documentReadingEnvFields = {
  // HazmatGuard extraction (plan H6, D10). Vision models are PINNED in env (not the shipped AI layer's
  // in-code strings) because a verdict must record the exact model id on every run for reproducibility.
  // Pass A = a Sonnet-class vision model; Pass B = a Haiku-class model (independent-prompt cross-read).
  HAZMAT_MODEL_A: z.string().default("claude-sonnet-4-6"),
  HAZMAT_MODEL_B: z.string().default("claude-haiku-4-5"),

  // Driver documents (0445, Step 0.1): BOL photos, delivery copies and call forms drivers submit in
  // Samsara's app. Fifteen minutes, because a dispatcher reading a BOL into the hazmat calculator is
  // waiting on it; the watermark makes a skipped tick cost nothing. 0 disables the tier outright.
  SAMSARA_DOCUMENTS_SYNC_MINUTES: z.coerce.number().min(0).default(15),
  // How far back an org's FIRST documents run reaches. Later runs resume from the newest stored row,
  // however old it is — this bounds the first run only.
  SAMSARA_DOCUMENTS_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
};
