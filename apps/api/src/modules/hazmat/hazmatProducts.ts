import type { HmtEntry } from "@hazmat/data";
import type { HazmatProduct } from "@silvicom/shared";
import { classifyMarinePollutantEntry } from "@hazmat/engine";

/**
 * HMT product lookup for the manual pickers (plan H5). Pure, dataset-driven search — the web app can't
 * import @hazmat/data, so the calculator/load-workspace pickers resolve products through the API
 * (`GET /hazmat/products`). One `HazmatProduct` per (entry × pg-row) so a pick yields a canonical
 * `hmtRef` (`${entryId}#${pg ?? 'none'}`) with no second PG step in the common case.
 *
 * This is a *convenience* surface, never a verdict input: it only turns text into a candidate `hmtRef`;
 * the deterministic engine (D1) still decides every placard/finding. Matching is exact-substring, never
 * fuzzy — near-miss ranking that could confidently surface the wrong product (1206/1208, 1267/1268) is
 * exactly what `resolveHmtLine()` (H6) forbids, so the picker mirrors that discipline: it filters, it
 * does not "best-guess".
 */

/**
 * Curated common-fuel IDs — the D4 launch scope (fuel + Table-2). Returned as the default set when no
 * query is supplied, and flagged `isFuelCommon` everywhere. Keyed on the 4-digit ID (UN and NA variants
 * both count as fuel-common). Order here is the display order of the default shortlist.
 */
const CURATED_FUEL_IDS: readonly string[] = [
  "1203", // Gasoline
  "1202", // Diesel fuel / Gas oil / Heating oil, light
  "1993", // Flammable / Combustible liquid, n.o.s.
  "1863", // Fuel, aviation, turbine engine
  "1223", // Kerosene
  "1267", // Petroleum crude oil
  "1268", // Petroleum distillates / products, n.o.s.
  "3475", // Ethanol and gasoline mixture (>10% ethanol)
  "1170", // Ethanol / Ethanol solution
  "1987", // Alcohols, n.o.s.
  "1075", // Petroleum gases, liquefied (LPG)
  "1978", // Propane
  "3257", // Elevated-temperature liquid, n.o.s. (HOT)
];
const CURATED_SET = new Set(CURATED_FUEL_IDS);
const curatedRank = (idNumber: string): number => {
  const i = CURATED_FUEL_IDS.indexOf(idNumber);
  return i === -1 ? CURATED_FUEL_IDS.length : i;
};

const norm = (s: string): string => s.trim().toLowerCase();

/** Extract 1–4 leading/embedded digits from an ID-style query ("un 1203", "NA1993", "1203" → "1203"). */
function idDigits(q: string): string | null {
  const digits = q.replace(/[^0-9]/g, "");
  return digits.length >= 1 && digits.length <= 4 ? digits : null;
}

function entryToProducts(entry: HmtEntry, isFuelCommon: boolean, marinePollutants: MarinePollutantRow[]): HazmatProduct[] {
  // ONE definition of "is this a marine pollutant", shared with the engine rule that acts on it.
  const mp = classifyMarinePollutantEntry(entry, marinePollutants);
  const idLabel = `${entry.idPrefix}${entry.idNumber}`;
  return entry.pgRows.map((row) => {
    const pg = row.pg;
    const classPart = entry.hazardClass ? ` · Class ${entry.hazardClass}` : "";
    const pgPart = pg ? ` · PG ${pg}` : "";
    return {
      hmtRef: `${entry.entryId}#${pg ?? "none"}`,
      entryId: entry.entryId,
      idPrefix: entry.idPrefix,
      idNumber: entry.idNumber,
      idLabel,
      psn: entry.psnPrinted,
      hazardClass: entry.hazardClass,
      subsidiaryClasses: entry.subsidiaryClasses,
      pg,
      symbols: entry.symbols,
      label: `${idLabel} · ${entry.psnPrinted}${classPart}${pgPart}`,
      isFuelCommon,
      isMarinePollutant: mp.listed,
      marinePollutantSevere: mp.listed ? mp.severe : null,
    } satisfies HazmatProduct;
  });
}

/** A match against one entry, with a rank (lower = stronger) used to order results before pg expansion. */
function matchRank(entry: HmtEntry, q: string, digits: string | null): number | null {
  if (digits !== null) {
    if (entry.idNumber === digits) return 0; // exact ID
    if (entry.idNumber.startsWith(digits)) return 1; // ID prefix
    // A numeric query only ever matches on ID — do not also substring-match names by digits.
    return null;
  }
  const names = [entry.psnPrinted, ...entry.psnAlternates].map(norm);
  if (names.some((n) => n === q)) return 2; // exact name
  if (names.some((n) => n.startsWith(q))) return 3; // name prefix
  if (names.some((n) => n.includes(q))) return 4; // name substring
  if (norm(`${entry.idPrefix}${entry.idNumber}`).includes(q)) return 5; // "un1203" style
  return null;
}

export interface SearchProductsOptions {
  q?: string;
  limit: number;
  /**
   * Appendix B, so each result can say whether §171.8 concentration is worth asking about.
   *
   * REQUIRED, not optional. It shipped optional for one commit and the public calculator's route
   * silently omitted it — every appendix-B product came back `isMarinePollutant: false` there while
   * the authenticated route was correct, and nothing failed, because an omitted optional is a valid
   * call. A test that genuinely does not care passes `[]`, which is a statement rather than a gap.
   */
  marinePollutants: MarinePollutantRow[];
}

/** The shape of an appendix-B row, as the dataset ships it. */
export interface MarinePollutantRow { nameNormalized: string; severe?: boolean }

/**
 * Search HMT entries for the picker. No/blank query → the curated fuel shortlist (display order).
 * With a query → ranked exact-substring matches over ID and names, expanded to one row per pg-row.
 */
export function searchProducts(entries: readonly HmtEntry[], opts: SearchProductsOptions): HazmatProduct[] {
  const q = opts.q ? norm(opts.q) : "";
  const mps = opts.marinePollutants;

  if (!q) {
    const curated = entries
      .filter((e) => CURATED_SET.has(e.idNumber))
      .sort((a, b) => curatedRank(a.idNumber) - curatedRank(b.idNumber) || a.idPrefix.localeCompare(b.idPrefix));
    return curated
      .flatMap((e) => entryToProducts(e, true, mps))
      .slice(0, opts.limit);
  }

  const digits = idDigits(q);
  const ranked: Array<{ entry: HmtEntry; rank: number }> = [];
  for (const entry of entries) {
    const rank = matchRank(entry, q, digits);
    if (rank !== null) ranked.push({ entry, rank });
  }
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      curatedRank(a.entry.idNumber) - curatedRank(b.entry.idNumber) ||
      a.entry.idNumber.localeCompare(b.entry.idNumber) ||
      a.entry.idPrefix.localeCompare(b.entry.idPrefix),
  );

  const products: HazmatProduct[] = [];
  for (const { entry } of ranked) {
    for (const p of entryToProducts(entry, CURATED_SET.has(entry.idNumber), mps)) {
      products.push(p);
      if (products.length >= opts.limit) return products;
    }
  }
  return products;
}
