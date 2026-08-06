/**
 * HazmatGuard clearing rules (plan H7, D2/D6/D8) — the SINGLE source of truth, shared by the web UI and
 * the API. The web uses it to avoid showing an action the reviewer can't take; the API `clearLoad` uses
 * the SAME function as the REAL fail-closed enforcement (a UI-only guard is not a guard — a direct API
 * call must be refused too). Keep this and the migration/state-machine in lockstep.
 */

/** The exact attestation string stored in hazmat_reviews.attestation (D8) — never paraphrase in the UI. */
export const HAZMAT_ATTESTATION_TEXT =
  "I attest I am trained under 49 CFR 172 Subpart H and have reviewed this assessment.";
export const HAZMAT_OVERRIDE_MIN_REASON = 20;

export function hazmatSpAttestationText(permits: string[]): string {
  const list = permits.length ? permits.join(", ") : "the special permit";
  return `I have read ${list} and confirm it covers this deviation for this shipper/carrier.`;
}

// A run whose flags include one of these either produced NO trustworthy verdict (unusable photo,
// extraction aborted, no document) or records a LEGAL DISQUALIFICATION (§10.2: driver/org
// qualification failures — an expired medical card is not a risk decision a supervisor is
// entitled to make). Either way: reject or fix, NEVER override-clear.
const UNCLEARABLE_CODES = new Set([
  "recapture_needed", "extraction_failed", "no_documents", "document_unreadable",
  "entitlement_revoked", "extraction_disabled", "budget_exhausted",
]);
// §10.2: qualification failures are prefix families, not an enumerable set (driver_unqualified:cdl,
// :training_safety, …) — hazmatUnclearableReason gained prefix matching for exactly this (M3).
const UNCLEARABLE_PREFIXES = ["driver_unqualified:", "org_unqualified:"];
// Override-able violations: real regulatory violations the customer may clear despite (D6), with a reason.
const VIOLATION_CODES = new Set(["eligibility_blocked", "quantity_unit_unrecognized"]);
const VIOLATION_PREFIXES = ["violation:", "segregation:", "line_unresolved:"];
const PROVISIONAL_CODES = new Set(["dataset_provisional", "provisional_dataset"]);

/** True when the flags contain an OVERRIDE-able regulatory violation (not a hard block, not a data-usability issue). */
export function hazmatHasViolation(flags: string[]): boolean {
  return flags.some((f) => VIOLATION_CODES.has(f) || VIOLATION_PREFIXES.some((p) => f.startsWith(p)));
}
/** A human-readable reason the load can't be cleared as-is, or null. Two families (§10.2): an
 *  untrustworthy read, and a legal disqualification — distinct messages because the remedies differ
 *  (recapture/re-run vs. fix the qualification record and re-analyze). */
export function hazmatUnclearableReason(flags: string[]): string | null {
  if (flags.some((f) => f.startsWith("driver_unqualified:") || f.startsWith("org_unqualified:"))) {
    return "This load carries a legal disqualification (driver or carrier qualification lapsed). It can NEVER be override-cleared — fix the qualification record and re-run the analysis.";
  }
  if (flags.some((f) => UNCLEARABLE_CODES.has(f) || UNCLEARABLE_PREFIXES.some((p) => f.startsWith(p)))) {
    return "This run produced no trustworthy read (unusable photo / extraction failed / no document). Reject for recapture or re-run — it cannot be cleared as-is.";
  }
  return null;
}

export type HazmatClearRefusal =
  | "provisional_dataset"
  | "document_unusable"
  | "sp_attestation_required"
  | "override_required";

export interface HazmatClearInput {
  flags: string[];
  datasetProvisional: boolean;
  specialPermits: string[];
  overrideReason?: string | null;
  spAcknowledged?: boolean;
}
export interface HazmatClearCheck {
  ok: boolean;
  code?: HazmatClearRefusal;
  message?: string;
  requiresOverride: boolean;
  requiresSpAttestation: boolean;
}

/**
 * The one clearing gate. Order matters: hard blocks (provisional dataset, unusable read) first — those
 * cannot be attested/overridden away — then the SP attestation, then the override reason. Returns the
 * refusal code so the API can 409 with a precise reason and the UI can explain the disabled button.
 */
export function checkHazmatClear(i: HazmatClearInput): HazmatClearCheck {
  const requiresOverride = hazmatHasViolation(i.flags);
  const requiresSpAttestation = i.specialPermits.length > 0;
  const base = { requiresOverride, requiresSpAttestation };

  const provisional = i.datasetProvisional || i.flags.some((f) => PROVISIONAL_CODES.has(f));
  if (provisional) {
    return { ok: false, code: "provisional_dataset", message: "The active regulatory dataset is provisional — no load can be cleared against it.", ...base };
  }
  const unusable = hazmatUnclearableReason(i.flags);
  if (unusable) return { ok: false, code: "document_unusable", message: unusable, ...base };

  if (requiresSpAttestation && !i.spAcknowledged) {
    return { ok: false, code: "sp_attestation_required", message: "A special-permit load requires the dedicated SP attestation — it can never clear on the standard attestation alone.", ...base };
  }
  if (requiresOverride && (i.overrideReason ?? "").trim().length < HAZMAT_OVERRIDE_MIN_REASON) {
    return { ok: false, code: "override_required", message: `Clearing a violation requires a typed override reason of at least ${HAZMAT_OVERRIDE_MIN_REASON} characters.`, ...base };
  }
  return { ok: true, ...base };
}

/** The exact attestation string to store: base + SP text + override reason, as the gate requires. */
export function buildHazmatAttestation(check: HazmatClearCheck, permits: string[], overrideReason: string): string {
  const parts = [HAZMAT_ATTESTATION_TEXT];
  if (check.requiresSpAttestation) parts.push(hazmatSpAttestationText(permits));
  if (check.requiresOverride) parts.push(`OVERRIDE: ${overrideReason.trim()}`);
  return parts.join(" ");
}
