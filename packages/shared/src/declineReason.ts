/**
 * DECLINE-REASON TAXONOMY (WP1 D1) — the ONE place an EFS decline reason is interpreted.
 *
 * Why a taxonomy instead of one regex: EFS prints the same header for very different events. Verified
 * against real reject exports (data-samples/RejectTransactionReport-260707092249.xlsx) and the
 * 0851226257 proximity case:
 *
 *   "INVALID TRUCKSTOP IN53790|Failed restrictions|"        → benign out-of-network attempt
 *   "INVALID TRUCKSTOP IN0851226257|Merchant Position Too Far|" → EFS's telematics geofence says the
 *                                                              card is NOT with its truck (fraud-grade)
 *
 * So the QUALIFIER decides, not the header — proximity is checked FIRST. And unknown phrasings are
 * never silently benign: they classify as "unknown" (weight 0) but are stored on the decline row
 * (reason_category) and surfaced in counts, so a new EFS phrasing shows up as a review-the-vocabulary
 * task instead of silently scoring Clear (the exact failure mode that let 0851226257 through).
 */

export type DeclineReasonCategory =
  | "proximity_failure" // EFS telematics geofence: merchant too far from the card's truck — fraud-grade
  | "site_restriction" // out-of-network / site / product / policy restriction — benign alone
  | "limit" // spend/volume limit exceeded
  | "card_not_active" // inactive / expired / not-yet-active card
  | "invalid_info" // pump-prompt mismatch (odometer / driver id / trip / PIN) — data-quality
  | "unknown"; // unrecognized phrasing — surfaced, never silently benign

export interface DeclineReasonClassification {
  category: DeclineReasonCategory;
  /** Signal weight for assessDecline (0 = informational only). */
  weight: number;
  label: string;
}

export const DECLINE_CATEGORY_META: Record<DeclineReasonCategory, { weight: number; label: string }> = {
  // ≥ OVERWHELMING (75) → a proximity failure raises an alert on its own. EFS already did the
  // telematics check at authorization time; ignoring its verdict is how 0851226257 scored Clear.
  proximity_failure: { weight: 85, label: "Failed proximity validation" },
  site_restriction: { weight: 30, label: "Site/product restriction" },
  limit: { weight: 30, label: "Limit exceeded" },
  card_not_active: { weight: 10, label: "Card not active" },
  invalid_info: { weight: 0, label: "Pump-prompt mismatch" },
  unknown: { weight: 0, label: "Unrecognized reason" },
};

/** Proximity/geofence phrasings observed (EFS alert + reject exports) and conservative aliases. */
const PROXIMITY = /position\s*too\s*far|failed\s*proximity|proximity\s*validation|merchant\s*position/;
/** Site / network / product / policy restrictions (superset of the pre-WP1 regex, minus limit). */
const RESTRICTION = /failed\s*restriction|invalid\s*truckstop|\bsite\b|location|geofence|product|restrict|not\s*allowed|unauthor|outside/;
const LIMIT = /limit\s*exceed/;
const CARD_NOT_ACTIVE = /inactive\s*card|non-?active\s*card|card\s*not\s*active|expired/;
const INVALID_INFO = /invalid\s*information|invalid\s*pin|\bodometer\b|driver\s*id|\btrip\s*number\b/;

/**
 * Classify an EFS decline reason from its code + description. Order matters: proximity outranks the
 * generic "INVALID TRUCKSTOP" header it often arrives under. Pure; never throws.
 */
export function classifyDeclineReason(code: string | null | undefined, description: string | null | undefined): DeclineReasonClassification {
  const t = `${code ?? ""} ${description ?? ""}`.toLowerCase();
  const category: DeclineReasonCategory = !t.trim()
    ? "unknown"
    : PROXIMITY.test(t)
      ? "proximity_failure"
      : LIMIT.test(t)
        ? "limit"
        : RESTRICTION.test(t)
          ? "site_restriction"
          : CARD_NOT_ACTIVE.test(t)
            ? "card_not_active"
            : INVALID_INFO.test(t)
              ? "invalid_info"
              : "unknown";
  return { category, ...DECLINE_CATEGORY_META[category] };
}

/** Count declines per reason category — the observability surface (digest / coverage). Pure. */
export function countDeclineCategories(
  rows: { error_code: string | null; error_description: string | null }[],
): Record<DeclineReasonCategory, number> {
  const out: Record<DeclineReasonCategory, number> = {
    proximity_failure: 0,
    site_restriction: 0,
    limit: 0,
    card_not_active: 0,
    invalid_info: 0,
    unknown: 0,
  };
  for (const r of rows) out[classifyDeclineReason(r.error_code, r.error_description).category] += 1;
  return out;
}
