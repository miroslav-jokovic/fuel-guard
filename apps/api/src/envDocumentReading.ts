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
  // The reader's own pins (D-DR8, Step 1.4). Unset by default, so each falls back to the hazmat pin
  // above — the hazmat names are aliases until retired, and a deployment that sets neither reads with
  // exactly the models it reads with today. Resolved in `modules/document-reading/model/models.ts`.
  // D-DR20 (owner, 2026-10-11): the reader is LOCKED to Sonnet 4.6 — its own default, no longer falling
  // through HAZMAT_MODEL_A, so a change to the hazmat extractor's pin cannot move the reader. Measured on the
  // ten office BOLs (DOCUMENT-READER-PLAN §7B.2): 0 wrong UN ids against Haiku 5.5's 5.
  DOC_READ_MODEL_A: z.string().min(1).default("claude-sonnet-4-6"),
  // Q-DR23 (owner, 2026-10-11): the second reader is Sonnet 5.5 — its own default, like pass A's. It
  // matched the paper on every value checked on the office BOLs (§7B.2), and a second reader as strong as
  // the first is what makes agreement mean something (§7B.1 P3).
  DOC_READ_MODEL_B: z.string().min(1).default("claude-sonnet-5-5"),
  // Layer 1 P2's page classifier (§7A.3, Q-DR19 (a)): what a page is and which way is up, one call per
  // page. Its own pin, not pass B's, because the default pass-B model failed the orientation half when
  // measured live on 2026-10-11 against the ten office BOLs (12 pages, each sent as stored and turned a
  // quarter counter-clockwise): Haiku 4.5 answered 2 of the 12 turned pages and missed the one page
  // scanned sideways; Haiku 5.5, Sonnet 4.6 and Sonnet 5.5 answered all 24. Haiku 5.5 is the cheapest of
  // the three. A deployment may pin another; the verdict row records the model that answered.
  DOC_CLASSIFY_MODEL: z.string().min(1).default("claude-haiku-5-5"),
  // §7B A5 (Q-DR22): the open-source OCR engine as a row-bound witness on each hazmat line's count, weight
  // and quantity (evidence/rowWitness.ts). On by default; "off" is the switch if the engine misbehaves on a
  // host — a read without it is exactly a read before A5. Its ~139 MB of model files are downloaded on first
  // use into DOC_OCR_CACHE_DIR (pinned revision and sha256, ocr/ocrModels.ts), once per container.
  DOC_OCR_WITNESS: z.enum(["on", "off"]).default("on"),
  DOC_OCR_CACHE_DIR: z.string().min(1).optional(),

  // Driver documents (0445, Step 0.1): BOL photos, delivery copies and call forms drivers submit in
  // Samsara's app. Fifteen minutes, because a dispatcher reading a BOL into the hazmat calculator is
  // waiting on it; the watermark makes a skipped tick cost nothing. 0 disables the tier outright.
  SAMSARA_DOCUMENTS_SYNC_MINUTES: z.coerce.number().min(0).default(15),
  // How far back an org's FIRST documents run reaches. Later runs resume from the newest stored row,
  // however old it is — this bounds the first run only.
  SAMSARA_DOCUMENTS_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
};
