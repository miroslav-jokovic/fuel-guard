/**
 * ads — the industry-neutral ads module (D-AD17, docs/ARCHITECTURE.md; ADS-AGENT-BUILD-WORKFLOW.md §2).
 * This file is its only public surface. A4 (2026-11-01) exports the AI rail: the one way an ads
 * worker asks Claude, with the per-agent switch, the monthly token budget and `ad_generations`
 * provenance inside it. The guard (A5), orchestrator (A6) and routes join here as they land.
 */
export { generateWithClaude } from "./generations/claudeGeneration.js";
export type { ClaudeGenerationDeps, ClaudeGenerationOutcome, ClaudeGenerationRequest } from "./generations/claudeGeneration.js";
