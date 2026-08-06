import type { Dataset } from "./schema.js";

/**
 * §172.800(b) security-plan applicability — M9, PROVISIONAL / SME-attestation pending.
 *
 * Criterion (eCFR-verified by the team, recorded in docs/18-HAZMATGUARD-PLAN.md, Phase H8): a security
 * plan is required for a "large bulk quantity" — a single packaging holding more than 792 gal — of a
 * Division 2.1 material or a Class 3 material in Packing Group I or II. That covers essentially every
 * gasoline or propane cargo-tank load this product targets.
 *
 * SCOPE BOUNDARY (no assumptions): this is the ONE §172.800(b) category with a documented, verified
 * figure for this product's context. The other §172.800(b) categories (PIH, select agents, other bulk
 * classes) and the entire §385.403 FMCSA safety-permit list are NOT auto-detected here — they are
 * threshold/zone-heavy and require SME attestation before encoding. Absence of a trigger from THIS
 * detector is therefore not a determination that no security plan is required; a hazmat-trained person
 * remains the backstop. `ATTESTED` stays false until an SME signs off on the criterion + threshold.
 */
export const SECURITY_PLAN_APPLICABILITY = {
  version: "0.1.0-provisional",
  attested: false as const,
  citation: "49 CFR 172.800(b) (large bulk quantity, via 49 CFR 171.8)",
  largeBulkGal: 792,
  provenance:
    "docs/18-HAZMATGUARD-PLAN.md Phase H8 (eCFR-verified by the team). SME re-attestation pending before ATTESTED flips true.",
} as const;

export interface SecurityPlanLine {
  /** Canonical `${entryId}#${pg}` (pg may be 'none'). */
  hmtRef: string;
  quantityValue: number;
  quantityUnit: "gal" | "lb" | "kg" | "L";
  packagingKind: "bulk" | "non_bulk";
}

export interface SecurityPlanResult {
  /** True when at least one line trips the (provisional) §172.800(b) large-bulk criterion. */
  required: boolean;
  reasons: string[];
  /** A matching-class line whose quantity was in a mass unit (no volumetric compare) — fail-closed. */
  indeterminateLines: number;
}

const litresPerGallon = 3.785411784;
const toGallons = (v: number, unit: SecurityPlanLine["quantityUnit"]): number | null =>
  unit === "gal" ? v : unit === "L" ? v / litresPerGallon : null; // mass units are not volumetric

/**
 * Evaluate the §172.800(b) large-bulk security-plan trigger over a load's lines. Pure; resolves each
 * line's hazard class from the dataset. Fail-closed: a class-matching line declared in a MASS unit
 * (no volumetric comparison possible) trips the trigger rather than being waved through.
 */
export function evaluateSecurityPlanApplicability(dataset: Dataset, lines: SecurityPlanLine[]): SecurityPlanResult {
  const byEntryId = new Map(dataset.entries.map((e) => [e.entryId, e]));
  const reasons: string[] = [];
  let indeterminateLines = 0;
  for (const l of lines) {
    const [entryId, pg = "none"] = l.hmtRef.split("#");
    const entry = byEntryId.get(entryId ?? "");
    if (!entry) continue; // unresolvable ref: not evidence of a matching class — leave to the engine/reviewer
    const cls = entry.hazardClass ?? "";
    const isDiv21 = cls === "2.1";
    const isClass3PgI_II = cls === "3" && (pg === "I" || pg === "II");
    if (!(isDiv21 || isClass3PgI_II)) continue;
    if (l.packagingKind !== "bulk") continue;
    const kind = isDiv21 ? "Division 2.1" : "Class 3 PG I/II";
    const gal = toGallons(l.quantityValue, l.quantityUnit);
    if (gal === null) {
      indeterminateLines += 1;
      reasons.push(`${entry.psnPrinted}: bulk ${kind} declared in ${l.quantityUnit} — the ${SECURITY_PLAN_APPLICABILITY.largeBulkGal}-gal threshold could not be checked; treated as triggering (fail-closed).`);
      continue;
    }
    if (gal > SECURITY_PLAN_APPLICABILITY.largeBulkGal) {
      reasons.push(`${entry.psnPrinted}: ${Math.round(gal)} gal bulk ${kind} exceeds the ${SECURITY_PLAN_APPLICABILITY.largeBulkGal}-gal large-bulk threshold (49 CFR 172.800(b)).`);
    }
  }
  return { required: reasons.length > 0, reasons, indeterminateLines };
}
