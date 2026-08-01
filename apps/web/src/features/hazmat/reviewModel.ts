/**
 * Review + attestation model (plan H7). Pure, import-light (no supabase) so it unit-tests headless. The
 * clearing rules are the fail-closed core (D2/D8): a load can only clear on a NAMED attestation, an
 * override of a violation demands a typed reason, a special-permit load needs the dedicated SP attestation,
 * and a provisional dataset blocks clearing entirely. The web mirrors these so a reviewer never sees an
 * enabled Clear button they aren't actually allowed to press — but the API + RLS are the real enforcement.
 */

/** The exact attestation string stored in hazmat_reviews.attestation (D8) — do not paraphrase in the UI. */
export const ATTESTATION_TEXT =
  "I attest I am trained under 49 CFR 172 Subpart H and have reviewed this assessment.";
export const OVERRIDE_MIN_REASON = 20;

export function spAttestationText(permits: string[]): string {
  const list = permits.length ? permits.join(", ") : "the special permit";
  return `I have read ${list} and confirm it covers this deviation for this shipper/carrier.`;
}

export type ReviewTier = "violation" | "conditional" | "warning" | "info";
export interface ReviewItem {
  code: string;
  label: string;
  tier: ReviewTier;
}

// Known flag codes → a human label + a tier. Unknown codes fall back to a readable default (never hidden).
const FLAG_LABELS: Record<string, { label: string; tier: ReviewTier }> = {
  eligibility_not_checked: { label: "Eligibility not checked — needs a company policy (H8).", tier: "conditional" },
  eligibility_blocked: { label: "Load is ineligible (policy or engine block).", tier: "violation" },
  dataset_provisional: { label: "Regulatory dataset is provisional — clearing is blocked.", tier: "violation" },
  provisional_dataset: { label: "Regulatory dataset is provisional — clearing is blocked.", tier: "violation" },
  lines_unconfirmed: { label: "Lines not confirmed (driver self-created load).", tier: "conditional" },
  reclassification_unconfirmed: { label: "Combustible-liquid reclassification not confirmed by a declared line.", tier: "conditional" },
  recapture_needed: { label: "Photo unusable — recapture required.", tier: "violation" },
  extraction_failed: { label: "Extraction failed — enter the fields manually.", tier: "violation" },
  quantity_missing: { label: "A line is missing its quantity.", tier: "conditional" },
  quantity_unit_unrecognized: { label: "A line's quantity unit was not recognized.", tier: "violation" },
  total_weight_mismatch: { label: "Line weights do not sum to the printed total.", tier: "conditional" },
  page_incomplete: { label: "A multi-page shipping paper is missing pages.", tier: "conditional" },
  has_preprinted_lines: { label: "Dormant pre-printed template lines — confirm they are not loaded.", tier: "warning" },
  no_documents: { label: "No BOL document is attached to this load.", tier: "violation" },
  document_unreadable: { label: "A BOL document could not be read from storage.", tier: "violation" },
  budget_exhausted: { label: "Extraction token budget exhausted for this month.", tier: "conditional" },
  entitlement_revoked: { label: "HazmatGuard entitlement was revoked mid-run.", tier: "violation" },
  extraction_disabled: { label: "Extraction is turned off — use the manual path.", tier: "conditional" },
};

const PREFIX_LABELS: Array<{ prefix: string; tier: ReviewTier; make: (rest: string) => string }> = [
  { prefix: "violation:", tier: "violation", make: (r) => `Rule violation: ${r}` },
  { prefix: "segregation:", tier: "violation", make: (r) => `Segregation violation: ${r}` },
  { prefix: "line_unresolved:", tier: "violation", make: (r) => `A line could not be resolved (${r}).` },
  { prefix: "pass_disagreement:", tier: "conditional", make: (r) => `Vision passes disagreed on ${r}.` },
  { prefix: "extended_weight_mismatch:", tier: "conditional", make: (r) => `Count × per-package weight ≠ line weight (${r}).` },
  { prefix: "line_partial:", tier: "conditional", make: (r) => `A line has a count or weight but not both (${r}).` },
  { prefix: "extracted_line_not_declared:", tier: "conditional", make: (r) => `Extracted line not on the declared load (${r}).` },
  { prefix: "declared_line_not_extracted:", tier: "conditional", make: (r) => `Declared line not found on the paper (${r}).` },
  { prefix: "quantity_mismatch:", tier: "conditional", make: (r) => `Declared vs extracted quantity differ (${r}).` },
  { prefix: "resolve:", tier: "conditional", make: (r) => `Resolution note: ${r}.` },
];

export function labelForFlag(code: string): ReviewItem {
  if (FLAG_LABELS[code]) return { code, ...FLAG_LABELS[code] };
  for (const p of PREFIX_LABELS) {
    if (code.startsWith(p.prefix)) return { code, tier: p.tier, label: p.make(code.slice(p.prefix.length)) };
  }
  return { code, tier: "conditional", label: code.replace(/_/g, " ") };
}

/** The flags of a run as ordered review items (violations first — the order a reviewer should work them). */
export function deriveReviewItems(flags: string[]): ReviewItem[] {
  const rank: Record<ReviewTier, number> = { violation: 0, conditional: 1, warning: 2, info: 3 };
  return flags.map(labelForFlag).sort((a, b) => rank[a.tier] - rank[b.tier]);
}

export function hasViolation(flags: string[]): boolean {
  return deriveReviewItems(flags).some((i) => i.tier === "violation" && i.code !== "dataset_provisional" && i.code !== "provisional_dataset");
}

export interface ClearGate {
  /** false when a hard block (provisional dataset) makes clearing impossible regardless of attestation. */
  canAttest: boolean;
  hardBlockReason: string | null;
  requiresOverride: boolean;
  requiresSpAttestation: boolean;
}
export function clearGate(flags: string[], datasetProvisional: boolean, specialPermits: string[]): ClearGate {
  const provisional = datasetProvisional || flags.includes("dataset_provisional") || flags.includes("provisional_dataset");
  return {
    canAttest: !provisional,
    hardBlockReason: provisional ? "The active regulatory dataset is provisional — no load can be cleared against it." : null,
    requiresOverride: hasViolation(flags),
    requiresSpAttestation: specialPermits.length > 0,
  };
}

export interface ClearAttempt {
  attested: boolean;
  spAttested: boolean;
  overrideReason: string;
}
/** Whether the reviewer has satisfied every gate to submit a clear. */
export function canSubmitClear(gate: ClearGate, a: ClearAttempt): boolean {
  if (!gate.canAttest || !a.attested) return false;
  if (gate.requiresSpAttestation && !a.spAttested) return false;
  if (gate.requiresOverride && a.overrideReason.trim().length < OVERRIDE_MIN_REASON) return false;
  return true;
}

/** The exact attestation string to store for this clear (base + SP + override reason, as applicable). */
export function buildAttestation(gate: ClearGate, a: ClearAttempt, permits: string[]): string {
  const parts = [ATTESTATION_TEXT];
  if (gate.requiresSpAttestation) parts.push(spAttestationText(permits));
  if (gate.requiresOverride) parts.push(`OVERRIDE: ${a.overrideReason.trim()}`);
  return parts.join(" ");
}
