import { registerHandler } from "../registry.js";
import { efsIngestHandler } from "./efsIngest.js";
import { efsSoapHandler } from "./efsSoap.js";
import { hazmatExtractHandler, hazmatAnalyzeHandler } from "./hazmat.js";
import {
  backfillHandler,
  rebuildHandler,
  rescoreDeclinedHandler,
  scoreDeclinedImportHandler,
  scoreImportHandler,
} from "./scoring.js";

/**
 * Register every queue job handler. Called once at process startup — on the worker (queue mode) AND on
 * the API (so `dispatchJob`'s in-process path can find handlers). Idempotent. As more kinds migrate off
 * the in-process `runJob` closures (WQ1b: efs_soap, sync_*, nightly_reconcile), their handlers land here.
 */
export function registerAllHandlers(): void {
  registerHandler("efs_ingest", efsIngestHandler);
  registerHandler("efs_soap_posted", efsSoapHandler);
  registerHandler("efs_soap_rejected", efsSoapHandler);
  registerHandler("hazmat_extract", hazmatExtractHandler);
  registerHandler("hazmat_analyze", hazmatAnalyzeHandler);
  registerHandler("rebuild", rebuildHandler);
  registerHandler("backfill", backfillHandler);
  registerHandler("score_import", scoreImportHandler);
  registerHandler("score_declined_import", scoreDeclinedImportHandler);
  registerHandler("rescore_declined", rescoreDeclinedHandler);
}
