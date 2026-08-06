import type { Dataset } from "./schema.js";

/**
 * §385.403 FMCSA safety-permit applicability — M9, PROVISIONAL / SME-attestation pending.
 *
 * §385.403 requires a motor carrier to hold an FMCSA safety permit to transport (eCFR-verified 2026-08):
 *   (a) a highway route-controlled quantity of Class 7 (radioactive) material;
 *   (b) more than 25 kg (55 lb) net weight of a Division 1.1, 1.2, or 1.3 material (or a placardable Div 1.5);
 *   (c) more than 1 L per package of a PIH material meeting Hazard Zone A;
 *   (d) a PIH material meeting Hazard Zone B in a bulk packaging;
 *   (e) a PIH material meeting Hazard Zone C or D in packaging >= 13,248 L (3,500 gal);
 *   (f) methane / natural gas / any liquefied gas >= 85% methane in bulk packaging >= 13,248 L (3,500 gal).
 *
 * SCOPE BOUNDARY (no assumptions): only category (b) is auto-detected here, because it is the ONLY one the
 * shipped dataset can evaluate — a division (hazardClass 1.1/1.2/1.3/1.5) plus a declared mass. Categories
 * (a), (c), (d), (e) and (f) require entry-level fields the dataset does NOT yet carry: radioactive
 * route-controlled-quantity (§173.403), PIH hazard zone A/B/C/D (§173.116/§173.133), and methane content.
 * Each is threshold/zone-heavy and is M9 dataset work pending SME attestation. Absence of a (b) trigger is
 * therefore NOT a determination that no safety permit is required; a hazmat-trained person remains the
 * backstop. `attested` stays false until an SME signs off on the criteria + thresholds.
 *
 * Fail-closed + conservative: the (b) threshold is on NET explosive weight; the declared line mass is used
 * as a conservative proxy (gross >= net, so this can only over-trigger, never under-trigger). A Division
 * 1.1/1.2/1.3 line declared in a VOLUME unit (no mass to compare) trips the trigger rather than passing.
 * Any Division 1.5 line trips it (the CFR sets no mass floor for placardable 1.5).
 */
export const SAFETY_PERMIT_APPLICABILITY = {
  version: "0.1.0-provisional",
  attested: false as const,
  citation: "49 CFR 385.403(b) (explosives Division 1.1/1.2/1.3 > 25 kg net, or placardable Division 1.5)",
  explosivesNetWeightKg: 25,
  explosivesNetWeightLb: 55,
  provenance:
    "eCFR 49 CFR 385.403 verified 2026-08. Only category (b) is dataset-evaluable today; (a)/(c)/(d)/(e)/(f) " +
    "require RCQ + PIH hazard-zone + methane-content fields not yet in @hazmat/data. SME attestation pending " +
    "before attested flips true.",
} as const;

export interface SafetyPermitLine {
  /** Canonical `${entryId}#${pg}` (pg may be 'none'). */
  hmtRef: string;
  quantityValue: number;
  quantityUnit: "gal" | "lb" | "kg" | "L";
  packagingKind: "bulk" | "non_bulk";
}

export interface SafetyPermitResult {
  /** True when at least one line trips the (provisional) §385.403(b) explosives criterion. */
  required: boolean;
  reasons: string[];
  /** Division 1.1/1.2/1.3 lines declared in a volume unit (no mass compare) — counted into `required`. */
  indeterminateLines: number;
  /** §385.403 candidate classes present that the dataset CANNOT yet evaluate (Class 7, PIH 6.1) — surfaced
   *  for the SME backstop; NOT auto-triggered (mirrors the §172.800 scope discipline). */
  undetectedCandidates: string[];
}

const KG_PER_LB = 0.45359237;
const toKg = (v: number, unit: SafetyPermitLine["quantityUnit"]): number | null =>
  unit === "kg" ? v : unit === "lb" ? v * KG_PER_LB : null; // gal/L are volumetric, not mass

/**
 * Evaluate the §385.403(b) explosives safety-permit trigger over a load's lines. Pure; resolves each
 * line's hazard class from the dataset. Fail-closed: a Division 1.1/1.2/1.3 line declared in a MASS unit
 * over 25 kg triggers; declared in a VOLUME unit (no mass comparison possible) it triggers anyway; any
 * Division 1.5 line triggers. Non-(b) §385.403 candidate classes are recorded, not auto-triggered.
 */
export function evaluateSafetyPermitApplicability(dataset: Dataset, lines: SafetyPermitLine[]): SafetyPermitResult {
  const byEntryId = new Map(dataset.entries.map((e) => [e.entryId, e]));
  const reasons: string[] = [];
  const undetected = new Set<string>();
  let indeterminateLines = 0;
  const kgThreshold = SAFETY_PERMIT_APPLICABILITY.explosivesNetWeightKg;

  for (const l of lines) {
    const [entryId] = l.hmtRef.split("#");
    const entry = byEntryId.get(entryId ?? "");
    if (!entry) continue; // unresolvable ref: not evidence of a matching class — leave to the engine/reviewer
    const cls = entry.hazardClass ?? "";

    // (b) explosives Division 1.1 / 1.2 / 1.3 — net-weight threshold (gross mass as a conservative proxy).
    if (cls === "1.1" || cls === "1.2" || cls === "1.3") {
      const kg = toKg(l.quantityValue, l.quantityUnit);
      if (kg === null) {
        indeterminateLines += 1;
        reasons.push(`${entry.psnPrinted}: Division ${cls} declared in ${l.quantityUnit} — the ${kgThreshold} kg (55 lb) threshold could not be checked; treated as triggering (fail-closed).`);
      } else if (kg > kgThreshold) {
        reasons.push(`${entry.psnPrinted}: ${kg.toFixed(1)} kg of Division ${cls} exceeds the ${kgThreshold} kg (55 lb) net-weight threshold (49 CFR 385.403(b)).`);
      }
      continue;
    }
    // (b) Division 1.5 — permit-required when placarded; no mass floor. Fail-closed on any declared line.
    if (cls === "1.5") {
      reasons.push(`${entry.psnPrinted}: Division 1.5 requires a safety permit when placarded (49 CFR 385.403(b)); treated as triggering (fail-closed).`);
      continue;
    }

    // (a) Class 7 RCQ and (c)-(e) PIH hazard zones — the dataset lacks RCQ / hazard-zone fields, so these
    // are recorded as candidates for the SME backstop, never silently passed and never auto-triggered.
    if (cls === "7") {
      undetected.add("Class 7 (radioactive): §385.403(a) highway route-controlled quantity is not dataset-evaluable — SME/dataset pending.");
    }
    if (cls === "6.1" || entry.subsidiaryClasses.includes("6.1")) {
      undetected.add("Poison-inhalation-hazard candidate (Class/subsidiary 6.1): §385.403(c)-(e) hazard zone is not dataset-evaluable — SME/dataset pending.");
    }
    // (f) methane/LNG >= 85% methane needs methane content — not dataset-evaluable; left to the SME backstop.
  }

  return { required: reasons.length > 0, reasons, indeterminateLines, undetectedCandidates: [...undetected] };
}
