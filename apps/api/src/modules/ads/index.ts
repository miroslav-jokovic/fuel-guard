/**
 * ads — the industry-neutral ads module (D-AD17, docs/ARCHITECTURE.md; ADS-AGENT-BUILD-WORKFLOW.md §2).
 * This file is its only public surface. A4 (2026-11-01) exports the AI rail: the one way an ads
 * worker asks Claude, with the per-agent switch, the monthly token budget and `ad_generations`
 * provenance inside it. The guard (A5), orchestrator (A6) and routes join here as they land.
 */
export { generateWithClaude } from "./generations/claudeGeneration.js";
export type { ClaudeGenerationDeps, ClaudeGenerationOutcome, ClaudeGenerationRequest } from "./generations/claudeGeneration.js";
// A5: the guard's doors (`/api/ads`) and the one path to a platform's spend methods.
export { adsRouter } from "./routes/guard.js";
export { guardedAreaChange, guardedSpend } from "./guard/budgetGuard.js";
export type { GuardDeps, GuardOutcome, SpendAsk } from "./guard/budgetGuard.js";
// A6: the orchestrator — its scheduler, the step a queued job runs, and the one writer of a campaign's state.
export { startAdsOrchestrator } from "./orchestrator/tick.js";
export { runCampaignStep } from "./orchestrator/runner.js";
export { adsWorkers } from "./orchestrator/workers.js";
// 2026-11-03 audit: ADS_ENABLED off is a brake (pause only), never an off switch for the pause.
export { brakeFor } from "./orchestrator/brake.js";
// B3b: Meta Automated Rules follow the settings in force; the `ads_rules_sync` job runs this.
export { syncOrgRules } from "./settings/rulesSyncJob.js";
// B4a: the hourly leads backfill — Meta forms → the LeadSink the caller hands in — and its scheduler.
export { backfillConnectionLeads, catchUpSince } from "./leads/backfill.js";
export type { BackfillResult } from "./leads/backfill.js";
export { adsLeadsBackfillDedupKey, startAdsLeadsBackfill } from "./leads/backfillTick.js";
// B4b: Meta's leadgen webhook (public, signature-checked) and the job that reads the lead it names.
export { metaWebhookRouter } from "./routes/metaWebhook.js";
export { fetchWebhookLead } from "./leads/leadFetch.js";
export { META_WEBHOOK_PATH, metaWebhookBootWarning } from "./leads/leadgenWebhook.js";
export { applyCampaignEvent } from "./orchestrator/transitions.js";
// D2b: who the carrier chose to hear a category; recruiting's lead alerts read it through the composition root.
export { configuredAlertRecipients, uncontactedLeadMinutes } from "./alerts/adsAlerts.js";
// D2d: a connection's backfill that has not succeeded for hours rings; the job handler knows its last done run.
export { alertBackfillStale } from "./alerts/intakeAlerts.js";
// B5a: the monitor's hourly insights pull → ads_spend_hourly, and its scheduler.
export { pullConnectionInsights } from "./monitor/insightsPull.js";
export type { InsightsResult } from "./monitor/insightsPull.js";
export { adsInsightsDedupKey, startAdsInsights } from "./monitor/insightsTick.js";
// B5b: the auto-pause checks the insights job runs after its pull (decisions: shared `monitorChecks`).
export { checkConnection } from "./monitor/checks.js";
// B5c: the daily reconcile — Meta against our rows, each mismatch one external_change — and its scheduler.
export { reconcileConnection } from "./monitor/reconcile.js";
export { adsReconcileDedupKey, startAdsReconcile } from "./monitor/reconcileTick.js";
// C3: the Higgsfield client — one render step (submit under the row's id, poll, copy to our storage), the sealed key.
export { renderStep, renderKey } from "./creative/higgsfield/render.js";
export type { RenderDeps, RenderInput, RenderOutcome } from "./creative/higgsfield/render.js";
export { HiggsfieldClient } from "./creative/higgsfield/higgsfieldClient.js";
export { higgsfieldKeyFor, sealHiggsfieldKey } from "./creative/higgsfield/higgsfieldKey.js";
export { HIGGSFIELD_CREDIT_PRICES } from "./creative/higgsfield/prices.js";
