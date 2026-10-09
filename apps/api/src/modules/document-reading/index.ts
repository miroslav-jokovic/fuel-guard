/**
 * document-reading — the document reader (docs/plans/document-reading/DOCUMENT-READER-PLAN.md).
 *
 * Profile-driven: it reads a document under a PROFILE registered in `@silvicom/shared`'s
 * `DOCUMENT_PROFILES` and knows no trucking vocabulary itself (D-DR1). Today it holds the model adapter
 * (Step 1.4, `model/`); intake, pages, orchestration, the queue job and the routes land as their steps
 * do. It must not reach into the hazmat module's extractor — the hazmat path becomes a CONSUMER of this
 * module (Phase 3), never its dependency.
 */
export {
  readPages,
  buildReadRequest,
  TransientModelError,
  READ_MAX_TOKENS,
  type ModelClient,
  type PageImage,
  type ReadPagesInput,
  type ReadPagesResult,
  type ReadPrompt,
  type ReadUsage,
} from "./model/readPages.js";
export {
  readSections,
  combinedSchemaHash,
  sectionWireSchemas,
  FAILURE_PRECEDENCE,
  type ReadSectionsResult,
  type SectionOutcome,
} from "./model/readSections.js";
export { readModels, type ReadModels } from "./model/models.js";
export { schemaComplexity, schemaHash, STRUCTURED_OUTPUT_LIMITS, wireSchemaFor } from "./model/wireSchema.js";
export {
  normaliseSource,
  NORMALISER_VERSION,
  WORKING_LONG_EDGE_PX,
  WORKING_MEDIA_TYPE,
  type CanonicalPage,
  type NormaliseOutcome,
} from "./pages/index.js";
