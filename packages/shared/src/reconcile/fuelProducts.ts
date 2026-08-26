/**
 * What Pilot sold us, keyed on Pilot's own product code.
 *
 * ── WHY A TABLE AND NOT TWO REGEXES ──────────────────────────────────────────────────────────────
 * The two documents describe the same four products in different words, and each parser grew its own
 * rule for reading them. The weekly statement reads a printed legend and gets three-digit codes
 * (`020`, `033`, `140`); the monthly export carries a `ProductCode` column with the same codes
 * unpadded (`20`, `33`, `140`) plus a `ProductDescription` in Pilot's own words. The export parser
 * matched `/truck diesel|diesel(?! exhaust)/i` against the description, which is correct for Truck
 * Diesel and Diesel Exhaust Fluid and says nothing at all about **Reefer** — the word does not contain
 * "diesel".
 *
 * Measured on the real 2026-06/07 export (account 139445, 5,997 product rows):
 *
 *     20  | Truck Diesel            3,459   → matched, correctly
 *     140 | Diesel Exhaust Fluid    2,477   → matched, correctly
 *     33  | Reefer                    120   → fell through to `other` and was never seen again
 *     400 | Miscellaneous              45   → `other`, correctly
 *
 * Those 120 reefer fills are dyed off-road diesel the carrier was billed for. The statement path
 * separates and reports them; the export path dropped them into an unnamed bucket and then told the
 * reader `0 reefer`. Same fleet, same week, two answers depending on which file Pilot happened to
 * send — which is the asymmetry D-FR7 exists to end.
 *
 * ── THE CODE IS THE KEY; THE DESCRIPTION IS THE FALLBACK ─────────────────────────────────────────
 * Codes are stable and were resolved empirically against `efs_transactions.item` with exact count
 * agreement on three of four products (`FUEL-SPEND-RECONCILIATION-PLAN.md` §1). Descriptions are
 * marketing text and can be reworded. An unrecognised code is `unknown` — reported and counted, never
 * bucketed into diesel, which is the same `known: false` convention the brand catalogue uses.
 */

/** Which physical tank a report line filled, or `none` for something that is not propulsion fuel. */
export type ReportTank = "tractor" | "reefer" | "none";

export interface PilotProduct {
  /** Canonical three-digit code, zero-padded — the two documents disagree about padding. */
  code: string;
  tank: ReportTank;
  /** `diesel` covers BOTH tanks: reefer fuel is diesel, it is simply dyed and bought off-road. */
  kind: "diesel" | "def" | "other";
  label: string;
  /** False when the code was not recognised, so a caller can report it rather than assume it. */
  known: boolean;
}

const TABLE: Record<string, Omit<PilotProduct, "code" | "known">> = {
  "020": { tank: "tractor", kind: "diesel", label: "Truck diesel" },
  // Diesel #1 — the winter blend. Propulsion fuel bought on the same terms; one line in five statements.
  "021": { tank: "tractor", kind: "diesel", label: "Diesel #1" },
  "033": { tank: "reefer", kind: "diesel", label: "Reefer diesel" },
  "140": { tank: "none", kind: "def", label: "DEF" },
  "400": { tank: "none", kind: "other", label: "Miscellaneous" },
};

/** Descriptions, in Pilot's own words — used ONLY when the code is absent or unrecognised. */
const BY_DESCRIPTION: Array<[RegExp, string]> = [
  [/exhaust fluid|\bdef\b/i, "140"],
  [/reefer/i, "033"],
  [/diesel\s*#?\s*1|winter/i, "021"],
  [/truck diesel|\bdiesel\b/i, "020"],
  [/miscellaneous|merchandise/i, "400"],
];

/** "20" → "020"; "140" stays. Padding differs between the statement and the export. */
export function normalizePilotProductCode(code: string | null | undefined): string | null {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length >= 3 ? digits : digits.padStart(3, "0");
}

/**
 * Classify one report line. The code wins; the description is consulted only when the code cannot
 * decide, so a reworded description can never silently reclassify a product.
 */
export function classifyPilotProduct(code: string | null | undefined, description?: string | null): PilotProduct {
  const norm = normalizePilotProductCode(code);
  if (norm && TABLE[norm]) return { code: norm, known: true, ...TABLE[norm]! };

  const desc = String(description ?? "");
  for (const [re, mapped] of BY_DESCRIPTION) {
    if (re.test(desc)) return { code: mapped, known: true, ...TABLE[mapped]! };
  }
  // Unknown: counted and surfaced, never folded into diesel. `tank: "none"` keeps it out of matching.
  return { code: norm ?? "", tank: "none", kind: "other", label: desc.trim() || "Unknown product", known: false };
}

/** Propulsion or reefer fuel — the lines a reconciliation can pair against a recorded fill. */
export const isMatchableFuel = (p: PilotProduct): boolean => p.kind === "diesel" && p.tank !== "none";
