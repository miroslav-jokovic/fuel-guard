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

/**
 * THE DECLINE IN PLAIN WORDS (F02-F04 PLAN.md chunk 14b, AUDIT.md W7) — what the Declines tab shows in
 * place of EFS's trace, which stays one hover away.
 *
 * EFS does not send a reason; it sends a pipe-delimited trace with a capitalised headline in front,
 * sometimes followed by its own transaction id (`IN<digits>`), then detail in the vendor's internal
 * vocabulary. Measured on production 2026-10-09 (90 days, 60 distinct texts): every one of them begins
 * with one of the headlines below.
 *
 *     INVALID CARD|GetCatScalesCard: no card found|
 *     LIMIT EXCEEDED|SCALES|1525 IN0875290201|CheckItems|
 *     ITEM NOT ALLOWED|OIL|SCALES IN3951403734|CheckItems|
 *     INVALID INFORMATION|UNIT NUMBER|779 IN0856977138||
 *
 * The headline is the reason; the trace after it is where the reason names WHAT (the product, the
 * prompt, the value typed). Proximity is read FIRST, for the reason `classifyDeclineReason` reads it
 * first: EFS files its geofence verdict under the same INVALID TRUCKSTOP headline as a benign
 * out-of-network stop, and only the qualifier tells them apart.
 *
 * ⚠ An unknown headline is shown as itself, in sentence case, never as a guess and never as empty. A
 * new EFS phrasing then reads as EFS wrote it, which is honest; the taxonomy's `unknown` count is
 * what tells somebody the vocabulary needs a line here.
 */
const PRODUCT: Record<string, string> = {
  SCALES: "scales",
  "CASH ADVANCE": "cash advance",
  ULSD: "diesel",
  ULSR: "diesel",
  "DIESEL EXHAUST FLUID": "DEF",
  OIL: "oil",
  "TRUCK PARTS": "truck parts",
  ADDITIVES: "additives",
};
const PROMPT: Record<string, string> = {
  "UNIT NUMBER": "unit number",
  ODOMETER: "odometer",
  "DRIVER ID": "driver ID",
  "TRIP NUMBER": "trip number",
  PIN: "PIN",
};
/** EFS's own routine names, which say where in EFS the check ran — nothing a person can act on. */
const INTERNAL = /^(checkitems|mcodeauth|failed restrictions|non-active card|location check:.*|supp_fee)$/i;

const stripId = (s: string): string => s.replace(/\s*\bIN\d+\s*$/, "").trim();
const sentence = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
const product = (s: string): string => PRODUCT[s] ?? s.toLowerCase();

/** EFS's headline and the trace segments after it, transaction ids removed and empties dropped. */
export function splitDeclineText(description: string | null | undefined): { head: string; rest: string[] } {
  const parts = (description ?? "").split("|").map(stripId);
  return { head: parts[0] ?? "", rest: parts.slice(1).filter((p) => p !== "") };
}

/**
 * One short sentence-case reason for a decline, from EFS's code and text. Pure; never throws, never
 * returns an empty string while EFS sent anything at all.
 */
export function plainDeclineReason(code: string | null | undefined, description: string | null | undefined): string {
  const { head, rest } = splitDeclineText(description);
  const detail = rest.filter((p) => !INTERNAL.test(p));
  const h = head.toUpperCase();
  const t = (description ?? "").toLowerCase();

  if (PROXIMITY.test(t)) return "Truck was not near this truck stop";
  if (h === "INVALID TRUCKSTOP FOR CUSTOMER") return "Truck stop not allowed for this company";
  if (h === "INVALID TRUCKSTOP") return "Truck stop not allowed for this card";
  if (h === "INVALID CARD") return "Card number not recognized";
  if (h === "INACTIVE CARD") return "Card is not active";
  if (h === "MAX AMOUNT EXCEEDED") return "Money code over its maximum amount";
  if (h === "DAILY MONEY CODE LIMIT EXCEEDED") return "Daily money code limit reached";
  if (h === "NO SECUREFUEL DATA") return "No location from the truck to check against";
  if (h === "SYSTEM ERROR") return "EFS system error";
  if (h === "LIMIT EXCEEDED") {
    const what = detail.find((p) => !/^\d+$/.test(p));
    return what ? `Limit reached: ${product(what)}` : "Limit reached";
  }
  if (h === "ITEM NOT ALLOWED") {
    const items = detail.filter((p) => !/^\d+$/.test(p)).map(product);
    return items.length ? `Not allowed on this card: ${items.join(", ")}` : "Item not allowed on this card";
  }
  if (h === "INVALID INFORMATION") {
    // A trace can name two prompts (`|DRIVER ID|ODOMETER||`) or a prompt and what was typed
    // (`|UNIT NUMBER|779||`); only a segment that is not itself a prompt is a value.
    const names = detail.filter((p) => p in PROMPT).map((p) => PROMPT[p]!);
    const typed = detail.find((p) => !(p in PROMPT));
    const name = names.length ? names.join(" and ") : "information";
    return typed && names.length === 1 ? `Wrong ${name} entered at the pump: ${typed}` : `Wrong ${name} entered at the pump`;
  }
  if (head) return sentence(head);
  // A headline that was only a transaction id: the first segment with words in it, else the code.
  const words = detail.find((p) => /[a-z]/i.test(p));
  if (words) return sentence(words);
  return code ? `EFS code ${code}` : "No reason given";
}
