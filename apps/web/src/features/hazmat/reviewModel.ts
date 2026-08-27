/**
 * Review UI model (plan H7). The CLEARING RULES now live in `@silvicom/shared` (hazmatReview) so the web
 * and the API `clearLoad` enforce ONE fail-closed definition — the server is the real gate, this only
 * decides what the reviewer sees. This file keeps the UI-only concern: turning run flags into readable,
 * ordered review items. The gate functions are re-exported for the panel under familiar names.
 */
export {
  HAZMAT_ATTESTATION_TEXT as ATTESTATION_TEXT,
  HAZMAT_OVERRIDE_MIN_REASON as OVERRIDE_MIN_REASON,
  hazmatSpAttestationText as spAttestationText,
  hazmatHasViolation as hasViolation,
  hazmatUnclearableReason,
  checkHazmatClear,
  buildHazmatAttestation,
  type HazmatClearCheck,
} from "@silvicom/shared";

import type { HazmatLoadRow } from "@silvicom/shared";

export type ReviewTier = "violation" | "conditional" | "warning" | "info";
export interface ReviewItem {
  code: string;
  label: string;
  tier: ReviewTier;
}

// Known flag codes → a human label + a tier. Unknown codes fall back to a readable default (never hidden).
const FLAG_LABELS: Record<string, { label: string; tier: ReviewTier }> = {
  eligibility_not_checked: { label: "Eligibility could not be auto-determined — a conditional finding, provisional dataset, or missing segregation grid left it unverified.", tier: "conditional" },
  eligibility_blocked: { label: "Load is ineligible (policy or engine block).", tier: "violation" },
  dataset_provisional: { label: "Regulatory dataset is provisional — clearing is blocked.", tier: "violation" },
  provisional_dataset: { label: "Regulatory dataset is provisional — clearing is blocked.", tier: "violation" },
  lines_unconfirmed: { label: "Lines not confirmed (driver self-created load).", tier: "conditional" },
  reclassification_unconfirmed: { label: "Combustible-liquid reclassification not confirmed by a declared line.", tier: "conditional" },
  recapture_needed: { label: "Photo unusable — recapture required (cannot be cleared as-is).", tier: "violation" },
  extraction_failed: { label: "Extraction failed — re-run or enter the fields manually (cannot be cleared as-is).", tier: "violation" },
  quantity_missing: { label: "A line is missing its quantity.", tier: "conditional" },
  quantity_unit_unrecognized: { label: "A line's quantity unit was not recognized.", tier: "violation" },
  total_weight_mismatch: { label: "Line weights do not sum to the printed total.", tier: "conditional" },
  page_incomplete: { label: "A multi-page shipping paper is missing pages.", tier: "conditional" },
  has_preprinted_lines: { label: "Dormant pre-printed template lines — confirm they are not loaded.", tier: "warning" },
  no_documents: { label: "No BOL document is attached to this load (cannot be cleared as-is).", tier: "violation" },
  document_unreadable: { label: "A BOL document could not be read from storage (cannot be cleared as-is).", tier: "violation" },
  budget_exhausted: { label: "Extraction token budget exhausted — re-run after topping up (cannot be cleared as-is).", tier: "violation" },
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

/**
 * Run flags → ordered review items. Ordered violations-first as an interim proxy for the D11 expert
 * audit-flow ordering (H3 Deliverable 0 — the SME's documented sequence — is not authored yet; when it
 * lands, sort by that sequence here). Unknown codes are surfaced, never hidden.
 */
export function deriveReviewItems(flags: string[]): ReviewItem[] {
  const rank: Record<ReviewTier, number> = { violation: 0, conditional: 1, warning: 2, info: 3 };
  return flags.map(labelForFlag).sort((a, b) => rank[a.tier] - rank[b.tier]);
}

// ── queue filters (plan H7 deliverable 1) ────────────────────────────────────────────────────────
export interface QueueFilter {
  vehicleId: string; // "" = any
  driverId: string; // "" = any
  search: string; // matches the load id or a declared line's text
}
export const emptyQueueFilter = (): QueueFilter => ({ vehicleId: "", driverId: "", search: "" });

/** Client-side queue filter by vehicle, driver, and a free-text search (over id + declared lines). */
export function filterReviewQueue(loads: HazmatLoadRow[], f: QueueFilter): HazmatLoadRow[] {
  const q = f.search.trim().toLowerCase();
  return loads.filter((l) => {
    if (f.vehicleId && l.vehicle_id !== f.vehicleId) return false;
    if (f.driverId && l.driver_id !== f.driverId) return false;
    if (q) {
      const hay = `${l.id} ${Array.isArray(l.declared_lines) ? JSON.stringify(l.declared_lines) : ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
