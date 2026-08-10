import { registerHandler } from "../registry.js";
import { efsIngestHandler } from "./efsIngest.js";
import { dataRetentionHandler } from "./retention.js";
import { dqBinderHandler } from "./dqBinder.js";
import { efsCardSyncHandler } from "./efsCardSync.js";
import { efsSoapHandler } from "./efsSoap.js";
import { efsProcessingHandler } from "./efsProcessing.js";
import { hazmatExtractHandler, hazmatAnalyzeHandler } from "./hazmat.js";
import {
  backfillHandler,
  patternSweepHandler,
  rebuildHandler,
  rescoreDeclinedHandler,
  scoreDeclinedImportHandler,
  scoreImportHandler,
} from "./scoring.js";
import {
  nightlyReconcileHandler,
  snapshotDriverWeekHandler,
  syncDriverScoresHandler,
  syncDriversHandler,
  syncHosHandler,
  syncIdleHandler,
  syncStatsHandler,
  syncTrailersHandler,
  syncVehiclesHandler,
} from "./samsara.js";

/**
 * Register every queue job handler. Called once at process startup — on the worker (queue mode) AND on
 * the API (so `dispatchJob`'s in-process path can find handlers). Idempotent. As more kinds migrate off
 * the in-process `runJob` closures, their handlers land here. WQ1c added the Samsara sync kinds +
 * `nightly_reconcile`, so every job kind now has a single handler definition served in both modes.
 */
export function registerAllHandlers(): void {
  registerHandler("efs_ingest", efsIngestHandler);
  registerHandler("efs_soap_posted", efsSoapHandler);
  registerHandler("efs_soap_rejected", efsSoapHandler);
  registerHandler("efs_process_import", efsProcessingHandler);
  // Card mirror sweep. Vendor-calling on the SHARED EFS service account, so kindCaps pins it to 1.
  registerHandler("efs_card_sync", efsCardSyncHandler);
  registerHandler("hazmat_extract", hazmatExtractHandler);
  registerHandler("hazmat_analyze", hazmatAnalyzeHandler);
  registerHandler("rebuild", rebuildHandler);
  registerHandler("backfill", backfillHandler);
  registerHandler("score_import", scoreImportHandler);
  registerHandler("score_declined_import", scoreDeclinedImportHandler);
  registerHandler("rescore_declined", rescoreDeclinedHandler);
  registerHandler("pattern_sweep", patternSweepHandler);
  // WQ1c — Samsara/telematics sync + nightly reconcile (vendor-calling; bounded lane via Q7 kindCaps).
  registerHandler("sync_vehicles", syncVehiclesHandler);
  registerHandler("sync_stats", syncStatsHandler);
  registerHandler("sync_trailers", syncTrailersHandler);
  registerHandler("sync_idle", syncIdleHandler);
  registerHandler("sync_hos", syncHosHandler);
  registerHandler("sync_drivers", syncDriversHandler);
  registerHandler("sync_driver_scores", syncDriverScoresHandler);
  registerHandler("snapshot_driver_week", snapshotDriverWeekHandler);
  registerHandler("nightly_reconcile", nightlyReconcileHandler);
  registerHandler("data_retention", dataRetentionHandler);
  registerHandler("dq_binder", dqBinderHandler);
}
