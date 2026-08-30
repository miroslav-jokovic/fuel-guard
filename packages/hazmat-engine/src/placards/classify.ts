import type { LoadInput, PlacardName } from "../types.js";
import { assertsPoisonInhalation } from "./tableSelect.js";

/**
 * Classification vocabulary for the §172.504 ladder — the dataset view, the placard-name map, and the
 * small pure predicates the ladder asks questions with.
 *
 * Split out of `compute.ts` when that file crossed the 500-line budget. It is a real seam rather than
 * a line-count trick: everything here answers "what IS this material", nothing here decides what to do
 * about it. `compute.ts` keeps the decisions.
 *
 * The engine may not import `@hazmat/data` (it is handed a dataset by the caller, so a verdict is
 * reproducible against the exact dataset version it was computed with), hence the local view types.
 */

// ── minimal consumer view of the dataset (engine may not import @hazmat/data) ────────────────────
export interface DsPgRow {
  pg: "I" | "II" | "III" | null;
  labelCodes?: string[];
  specialProvisions?: string[];
  /** §172.101 column 8A (datasets ≥ 2026.08.0) — the §173.* exceptions section ("150" → §173.150),
   *  null = printed "None"/blank, ABSENT (undefined) = the dataset predates the column (H-LQ). */
  exceptionsRef?: string | null;
}
export interface DsEntry {
  entryId: string;
  psnPrinted: string;
  psnAlternates?: string[];
  hazardClass: string | null;
  subsidiaryClasses?: string[];
  idPrefix: "UN" | "NA";
  idNumber: string;
  pgRows: DsPgRow[];
}
export interface DsPlacard { classOrDivision: string; table: 1 | 2; placardName: string; designRef: string | null; wordingOptions?: string[] }
export interface DsErg { idNumber: string; guideNumber: string }
/** Appendix B to §172.101 — the marine pollutant list, "PP" in the S.M.P. column meaning severe. */
export interface DsMarinePollutant { nameNormalized: string; severe?: boolean }

export interface DsView {
  version: string;
  provisional: boolean;
  entries: DsEntry[];
  placards: DsPlacard[];
  erg: DsErg[];
  marinePollutants: DsMarinePollutant[];
}

export function readDataset(load: LoadInput): DsView {
  const d = load.dataset as unknown as Partial<DsView>;
  return {
    version: d.version ?? "unknown",
    provisional: d.provisional === true,
    entries: Array.isArray(d.entries) ? d.entries : [],
    placards: Array.isArray(d.placards) ? d.placards : [],
    erg: Array.isArray(d.erg) ? d.erg : [],
    // Absent on a minimal dataset view, and on every dataset cut before Appendix B was imported —
    // an empty list simply matches nothing, which is the same answer as "not a marine pollutant".
    marinePollutants: Array.isArray(d.marinePollutants) ? d.marinePollutants : [],
  };
}

export const PLACARD_NAMES = new Set<PlacardName>([
  "FLAMMABLE", "GASOLINE", "COMBUSTIBLE", "FUEL_OIL", "FLAMMABLE_GAS", "NON_FLAMMABLE_GAS",
  "OXYGEN", "POISON_GAS", "FLAMMABLE_SOLID", "SPONTANEOUSLY_COMBUSTIBLE", "DANGEROUS_WHEN_WET",
  "OXIDIZER", "ORGANIC_PEROXIDE", "POISON", "POISON_INHALATION_HAZARD", "CORROSIVE",
  "RADIOACTIVE", "CLASS_9", "DANGEROUS",
  "EXPLOSIVES_1_1", "EXPLOSIVES_1_2", "EXPLOSIVES_1_3", "EXPLOSIVES_1_4", "EXPLOSIVES_1_5", "EXPLOSIVES_1_6",
]);

export function toPlacardName(printed: string): PlacardName | null {
  const key = printed.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return PLACARD_NAMES.has(key as PlacardName) ? (key as PlacardName) : null;
}

/** Leading class/division token, e.g. "5.2 (Organic…)" → "5.2"; "Combustible liquid" → "combustible liquid". */
export function baseClass(s: string): string {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(s);
  return m ? (m[1] as string) : s.trim().toLowerCase();
}

/** The class a line should be PLACARDED as (honors the §173.150(f) combustible-liquid reclassification). */
export function effectiveClassKey(entry: DsEntry, reclassedCombustible: boolean): string {
  const hc = entry.hazardClass ?? "";
  if (reclassedCombustible && baseClass(hc) === "3") return "combustible liquid";
  if (/comb/i.test(hc)) return "combustible liquid";
  return baseClass(hc);
}

/** Class 1 divisions. 1.1–1.3 are Table 1; 1.4–1.6 are Table 2 but deferred by D4 — both are blocked. */
export function isExplosivesDivision(key: string): boolean {
  return /^1\.[1-6]$/.test(key);
}

/** §172.504(b): a category with ≥1,000 kg loaded at one facility keeps its own placard. */
export const DANGEROUS_CATEGORY_BAR_LB = 2205;

/** §172.505 subsidiary hazards decidable from the table: inhalation, and dangerous-when-wet. */
export function subsidiary505(entry: DsEntry): { pih: boolean; dww: boolean } {
  return {
    pih: assertsPoisonInhalation(entry),
    dww: (entry.subsidiaryClasses ?? []).some((c) => c.trim() === "4.3"),
  };
}

/** The pgRow an `hmtRef` ("entryId#PG" / "entryId#none") points at; first row when no match. */
export function pgRowForRef(entry: DsEntry, hmtRef: string): DsPgRow | null {
  const token = hmtRef.split("#")[1] ?? "none";
  const pg = token === "none" ? null : token;
  return entry.pgRows.find((r) => (r.pg ?? null) === pg) ?? entry.pgRows[0] ?? null;
}

/** §173.150(b)/§173.155(b)-family LQ per-package cap: 30 kg (66 lb) gross. */
export const LQ_PACKAGE_GROSS_CAP_LB = 66;

/** The classes whose LQ semantics 0.10.0 ENCODES (the 30 kg/66 lb family with the §172.315 ground
 *  mark). Gases (§173.306 — different structure) and Divisions 6.1/6.2 + Classes 1/7 (excluded from
 *  the §172.315 mark scheme) are NOT encoded: an LQ claim there is refused fail-closed. */
export const LQ_ENCODED_CLASS_KEYS = new Set<string>(["3", "combustible liquid", "4.1", "5.1", "5.2", "8", "9"]);
