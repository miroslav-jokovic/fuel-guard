import { z } from "zod";

/**
 * @hazmat/engine — the deterministic HazmatGuard rules engine (Phase H0 skeleton).
 *
 * A PURE function library: no I/O, no clock (the caller passes `evaluatedAt`), no network, no DB, and —
 * enforced in CI (scripts/check-feature-boundaries.mjs) — ZERO imports from any other workspace package.
 * Zod is the single allowed dependency, for the I/O schemas. Verdicts come from the CFR (D1); this is
 * where that logic will live. H0 ships the contracts + fail-closed stubs only; H1–H3 implement them.
 */

export const ENGINE_VERSION = "0.1.0";

// ── Dataset contract ──────────────────────────────────────────────────────────
// The CALLER loads this from @hazmat/data and passes it in; the engine never loads a dataset itself.
// Shape is opaque at the skeleton stage — H1 locks the 49 CFR 172.101 table + appendices.
export interface HazmatDataset {
  /** Dataset release id, e.g. "2026.02" — stored on every verdict for reproducibility (D9). */
  version: string;
  readonly entries: readonly unknown[];
}

// ── Inputs ────────────────────────────────────────────────────────────────────
export const bolLineSchema = z.object({
  idNumber: z.string().nullable(),
  properShippingName: z.string().nullable(),
  hazardClass: z.string().nullable(),
  packingGroup: z.string().nullable(),
  quantity: z.string().nullable(),
});
export type BolLine = z.infer<typeof bolLineSchema>;

export const loadInputSchema = z.object({
  /** The caller's clock — the engine never calls Date.now() (determinism + reproducibility). */
  evaluatedAt: z.string(),
  lines: z.array(bolLineSchema).default([]),
  grossWeightLb: z.number().nullable().default(null),
  /** Dock facts the BOL can't answer (SME flow, plan Appendix E) — null until the driver confirms. */
  soleProductInTrailer: z.boolean().nullable().default(null),
  isPortPickupOrDelivery: z.boolean().nullable().default(null),
});
export type LoadInput = z.infer<typeof loadInputSchema>;

// ── Outputs ───────────────────────────────────────────────────────────────────
/** Fail-closed states (D2): nothing is `cleared` without a fully-green run or a human attestation. */
export type Verdict = "cleared" | "needs_review" | "blocked" | "not_applicable";

export interface Finding {
  code: string;
  /** CFR citation for this finding (D1 — every finding cites the reg). */
  citation: string | null;
  message: string;
}

export interface PlacardResult {
  verdict: Verdict;
  placards: readonly string[];
  marks: { idNumbers: readonly string[]; marinePollutant: boolean };
  findings: readonly Finding[];
}
export interface BolResult {
  verdict: Verdict;
  findings: readonly Finding[];
}
export interface EligibilityResult {
  status: "eligible" | "blocked" | "needs_review";
  findings: readonly Finding[];
}
export interface SegregationResult {
  verdict: Verdict;
  findings: readonly Finding[];
}
export interface LoadEvaluation {
  engineVersion: string;
  datasetVersion: string;
  verdict: Verdict;
  placards: PlacardResult;
  bol: BolResult;
  eligibility: EligibilityResult;
  segregation: SegregationResult;
}

// ── Entry points (H0: explicitly not implemented; H1–H3 replace these) ─────────
export class NotImplementedError extends Error {
  constructor(fn: string) {
    super(`${fn}() is not implemented yet — HazmatGuard Phase H0 skeleton`);
    this.name = "NotImplementedError";
  }
}

export function computePlacards(_load: LoadInput, _data: HazmatDataset): PlacardResult {
  throw new NotImplementedError("computePlacards");
}
export function validateBol(_load: LoadInput, _data: HazmatDataset): BolResult {
  throw new NotImplementedError("validateBol");
}
export function checkEligibility(_load: LoadInput, _data: HazmatDataset): EligibilityResult {
  throw new NotImplementedError("checkEligibility");
}
export function checkSegregation(_load: LoadInput, _data: HazmatDataset): SegregationResult {
  throw new NotImplementedError("checkSegregation");
}
export function evaluateLoad(_load: LoadInput, _data: HazmatDataset): LoadEvaluation {
  throw new NotImplementedError("evaluateLoad");
}
