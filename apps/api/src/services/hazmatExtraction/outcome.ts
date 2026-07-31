import type { Verdict } from "@hazmat/engine";
import { computeManualFlags } from "../hazmatAnalysis.js";
import type { ExtractResult } from "./extract.js";

/**
 * The H6 outcome table (plan step 6) — the auto-clear boundary, owned by the orchestrator and applied to
 * EVERY run. It unions the extraction/cross-validation flags with the engine-verdict flags (reusing the
 * manual path's `computeManualFlags`, so the two paths share one fail-closed definition). Any non-empty
 * result ⇒ `needs_review`; only a fully-empty flag set ⇒ green/`cleared` (D2). With today's engine
 * (eligibility always `not_checked`) the verdict side always contributes a flag, so nothing auto-clears
 * until H8 — exactly the safe default. `verdict` is null when the page was unusable / extraction failed
 * (no verdict was computed); then only the pipeline flags decide (e.g. `recapture_needed`).
 */
export function computeExtractionFlags(
  extract: ExtractResult,
  verdict: Verdict | null,
  datasetProvisional: boolean,
): string[] {
  const flags = new Set(extract.flags);
  if (extract.usable && verdict) {
    for (const f of computeManualFlags(verdict, datasetProvisional)) flags.add(f);
  }
  return [...flags];
}

/** Green (auto-clear-eligible) iff there is not a single flag. */
export function isGreen(flags: string[]): boolean {
  return flags.length === 0;
}
