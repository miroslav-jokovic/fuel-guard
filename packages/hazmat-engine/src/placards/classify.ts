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
export interface DsPgRow { pg: "I" | "II" | "III" | null; labelCodes?: string[]; specialProvisions?: string[] }
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
export interface DsView { version: string; provisional: boolean; entries: DsEntry[]; placards: DsPlacard[]; erg: DsErg[] }

export function readDataset(load: LoadInput): DsView {
  const d = load.dataset as unknown as Partial<DsView>;
  return {
    version: d.version ?? "unknown",
    provisional: d.provisional === true,
    entries: Array.isArray(d.entries) ? d.entries : [],
    placards: Array.isArray(d.placards) ? d.placards : [],
    erg: Array.isArray(d.erg) ? d.erg : [],
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
