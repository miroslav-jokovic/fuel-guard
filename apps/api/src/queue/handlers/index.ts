import { registerHandler } from "../registry.js";
import { fleetpalSyncHandler } from "./fleetpal.js";
import { medstopSyncHandler } from "./medstop.js";
import { adsStepHandler } from "./adsStep.js";
import { adsRulesSyncHandler } from "./adsRulesSync.js";
import { adsLeadsBackfillHandler } from "./adsLeadsBackfill.js";
import { adsLeadFetchHandler } from "./adsLeadFetch.js";
import { leadUncontactedHandler } from "./leadUncontacted.js";
import { adsInsightsHandler } from "./adsInsights.js";
import { adsReconcileHandler } from "./adsReconcile.js";
import { adsDailyBriefHandler } from "./adsDailyBrief.js";
import { adsOutcomeFeedHandler } from "./adsOutcomeFeed.js";
import { adsRenderHandler } from "./adsRender.js";
import { efsIngestHandler } from "./efsIngest.js";
import { dataRetentionHandler } from "./retention.js";
import { idleEngineHandler } from "./idleEngine.js";
import { dqBinderHandler } from "./dqBinder.js";
import { paperIntakeSplitHandler } from "./paperIntakeSplit.js";
import { documentDeriveHandler } from "./documentDerive.js";
import { efsCardStatusHandler, efsCardSyncHandler } from "./efsCardSync.js";
import { efsSoapHandler, efsWindowRefetchHandler } from "./efsSoap.js";
import { efsProcessingHandler } from "./efsProcessing.js";
import { hazmatExtractHandler, hazmatAnalyzeHandler } from "./hazmat.js";
import { documentReadHandler } from "./documentRead.js";
import { documentIntakeHandler } from "./documentIntake.js";
import {
  backfillHandler,
  patternSweepHandler,
  rebuildHandler,
  rescoreDeclinedHandler,
  scoreDeclinedImportHandler,
  scoreImportHandler,
} from "./scoring.js";
import {
  syncDriversHandler,
  syncHosHandler,
  syncIdleHandler,
  syncIftaHandler,
  syncOdometerHandler,
  syncDocumentsHandler,
  syncStatsHandler,
  syncTrailersHandler,
  syncVehiclesHandler,
} from "./samsara.js";
import {
  idleEventTwinsHandler,
  snapshotDriverWeekHandler,
  syncDriverScoresHandler,
} from "./performance.js";
import { nightlyReconcileHandler } from "./nightlyReconcile.js";
import { financialProjectionHandler } from "./financial.js";

/**
 * Register every queue job handler. Called once at process startup — on the worker (queue mode) AND on
 * the API (so `dispatchJob`'s in-process path can find handlers). Idempotent. As more kinds migrate off
 * the in-process `runJob` closures, their handlers land here. WQ1c added the Samsara sync kinds +
 * `nightly_reconcile`, so every job kind now has a single handler definition served in both modes.
 */
export function registerAllHandlers(): void {
  registerHandler("efs_ingest", efsIngestHandler);
  registerHandler("efs_soap_posted", efsSoapHandler);
  registerHandler("efs_window_refetch", efsWindowRefetchHandler);
  registerHandler("efs_soap_rejected", efsSoapHandler);
  registerHandler("efs_process_import", efsProcessingHandler);
  // Card mirror sweep. Vendor-calling on the SHARED EFS service account, so kindCaps pins it to 1.
  registerHandler("efs_card_sync", efsCardSyncHandler);
  // The status poll: same account, same cap of one.
  registerHandler("efs_card_status", efsCardStatusHandler);
  registerHandler("hazmat_extract", hazmatExtractHandler);
  registerHandler("hazmat_analyze", hazmatAnalyzeHandler);
  registerHandler("document_read", documentReadHandler);
  registerHandler("document_intake", documentIntakeHandler);
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
  registerHandler("idle_event_twins", idleEventTwinsHandler);
  registerHandler("sync_ifta", syncIftaHandler);
  registerHandler("sync_odometer", syncOdometerHandler);
  registerHandler("sync_documents", syncDocumentsHandler);
  registerHandler("sync_hos", syncHosHandler);
  registerHandler("sync_drivers", syncDriversHandler);
  registerHandler("sync_driver_scores", syncDriverScoresHandler);
  registerHandler("snapshot_driver_week", snapshotDriverWeekHandler);
  registerHandler("nightly_reconcile", nightlyReconcileHandler);
  registerHandler("data_retention", dataRetentionHandler);
  registerHandler("idle_engine", idleEngineHandler);
  registerHandler("financial_projection", financialProjectionHandler);
  registerHandler("dq_binder", dqBinderHandler);
  // Scanned stacks of paper driver files, cut at their cover sheets (DRIVER-PAPER-INTAKE-PLAN PI2).
  registerHandler("paper_intake_split", paperIntakeSplitHandler);
  registerHandler("document_derive", documentDeriveHandler);
  // The FleetPal sweep (F8). Vendor-calling, so it shares the bounded lane the Samsara and EFS
  // kinds use — and its cap is 1 because FleetPal publishes no rate limit at all (F4).
  registerHandler("fleetpal_sync", fleetpalSyncHandler);
  registerHandler("medstop_sync", medstopSyncHandler);
  // A6: one orchestrator step for one campaign; dedup-keyed per campaign + state by its tick.
  registerHandler("ads_step", adsStepHandler);
  // B3b: Meta Automated Rules follow the settings in force, after each save.
  registerHandler("ads_rules_sync", adsRulesSyncHandler);
  registerHandler("ads_leads_backfill", adsLeadsBackfillHandler);
  registerHandler("ads_lead_fetch", adsLeadFetchHandler);
  // B5a: one connection's hourly insights → ads_spend_hourly; dedup-keyed per connection by its tick.
  registerHandler("ads_insights", adsInsightsHandler);
  // B5c: one connection's daily reconcile; dedup-keyed per connection by its tick.
  registerHandler("ads_reconcile", adsReconcileHandler);
  // F1b: one carrier's morning brief; dedup-keyed per org by its tick, once a day by the bell's key.
  registerHandler("ads_daily_brief", adsDailyBriefHandler);
  // B6: one Meta connection's daily outcome feed; dedup-keyed per connection by its tick.
  registerHandler("ads_outcome_feed", adsOutcomeFeedHandler);
  // D2c: one carrier's sweep for leads nobody has contacted; dedup-keyed per org by its tick.
  registerHandler("lead_uncontacted", leadUncontactedHandler);
  registerHandler("ads_render", adsRenderHandler);
}
