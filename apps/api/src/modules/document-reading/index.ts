/**
 * document-reading — the document reader (docs/plans/document-reading/DOCUMENT-READER-PLAN.md).
 *
 * Profile-driven: it reads a document under a PROFILE registered in `@silvicom/shared`'s
 * `DOCUMENT_PROFILES` and knows no trucking vocabulary itself (D-DR1). Today it holds the model adapter
 * (Step 1.4, `model/`), the pages stage (Step 1.3, `pages/`) and the read itself (Step 1.6, `read/`);
 * intake and the routes land as their steps do. It must not reach into the hazmat module's extractor — the hazmat path becomes a CONSUMER of this
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
export { executeRead, failUnavailableRead, type ExecuteReadOutcome, type ReadDeps, type ReadGate, type ReadGateFor } from "./read/executeRead.js";
export { readCacheKey, ACCEPTANCE_RULE_VERSION, type CacheKeyInput } from "./read/cacheKey.js";
export { READ_PROMPTS } from "./read/prompts.js";
export { documentsRouter } from "./routes/documents.js";
export { readDispatcher } from "./dispatch.js";
export { runIntake, registerUpload, sourceStatus, intakeDedupKey, type IntakeJob, type IntakeOutcome } from "./intake/intake.js";
export { requestRead, getRead, recordReviews, reviewEntryProblem, readDedupKey } from "./read/requests.js";
export { DOCUMENT_BUCKET } from "./storage.js";
