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
export { applyCampaignEvent } from "./orchestrator/transitions.js";
