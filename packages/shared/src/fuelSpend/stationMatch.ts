/**
 * Resolve a recorded fill to a station in the registry (pure, dataset-free).
 *
 * `fuel_transactions.station_id` shipped as a column in migration 0243 and was never populated, which
 * is why "how much at ONE9", "how much off-network" and every other brand question could only be
 * answered from an uploaded vendor statement. This is the matcher that fills it in.
 *
 * ── WHY THE PILOT FAMILY IS MATCHED ON (STORE, STATE) AND NOT ON BRAND ───────────────────────────
 * EFS writes the BILLING brand, not the site's brand. `PILOT JAMESTOWN 305` in New Mexico is a Flying
 * J in the registry; `FLYING J ELOY 609` in Arizona is a Pilot. Keying on the parsed brand throws
 * those away — measured on production, matching `(brand, store)` missed 294 fills, of which the three
 * largest keys (`pilot#305`, `pilot#4563`, `pilot#893`) were all Flying J stores sitting right there
 * in the registry. `smartFueling/brands.ts` documents the same trap for the price feeds.
 *
 * Store numbers are unique across the whole Pilot family and only within it, so the family is matched
 * on `(store, state)` and every other network on `(brand, store, state)`. Kwik Trip #1015 and Pilot
 * #1015 are different places and must never resolve to each other.
 *
 * ── WHY THE RAW STORE NUMBER IS TRIED FIRST ──────────────────────────────────────────────────────
 * The registry contains zero-padded duplicates of the same store — `031` with no city alongside `31`
 * for Highland, Indiana. Normalising both sides by stripping zeros folds those into one key and makes
 * 54 keys ambiguous, which cost 790 fills to an "ambiguous, skip it" branch. Matching the store number
 * exactly as printed resolves them, because raw `(store, state)` IS unique; the padded variants are
 * only tried when the raw one finds nothing.
 *
 * ── WHY AN UNRESOLVED FILL STAYS NULL ────────────────────────────────────────────────────────────
 * 3.6% of production fills do not resolve and should not: genuine independents (`MONROE MART`),
 * Pilot-branded dealer sites printed without a number (`PILOT TOWN PUMP BILLINGS`), and a handful of
 * store numbers with no registry row. A guessed station_id would put fuel at a brand it was never
 * bought from, and brand analysis is exactly what this column exists to support. Null is the honest
 * answer and `unresolved` counts it.
 */
import { parseStationIdentity } from "../efsImport/reconcile.js";
import { PILOT_FAMILY_BRANDS } from "../smartFueling/brands.js";

const FAMILY = new Set<string>(PILOT_FAMILY_BRANDS);

export interface StationRef {
  id: string;
  brand: string;
  storeNumber: string;
  state: string | null;
}

export interface StationIndex {
  /** (store|state) across the Pilot family — EFS's billing brand cannot be trusted. */
  family: Map<string, StationRef[]>;
  /** (brand|store|state) for every network, including the family, for an exact-brand hit. */
  exact: Map<string, StationRef[]>;
  stations: number;
}

/** Why a fill did or did not resolve. Every outcome is counted; none is silently dropped. */
export type StationMatchReason =
  | "family" // matched across the Pilot family on (store, state)
  | "brand" // matched a non-family network on (brand, store, state)
  | "no_brand" // the location string names no network we know
  | "no_store" // a known brand, but no store number printed
  | "no_state" // the fill carries no state, so a store number cannot be placed
  | "unmatched" // parsed a key; the registry has no such station
  | "ambiguous"; // more than one station answers to the key — never guessed between

export interface StationMatch {
  stationId: string | null;
  brand: string | null;
  reason: StationMatchReason;
  /** The key that was looked up, for reporting what is missing from the registry. */
  key: string | null;
}

const push = <T,>(m: Map<string, T[]>, k: string, v: T): void => {
  const cur = m.get(k);
  if (cur) cur.push(v);
  else m.set(k, [v]);
};

export function buildStationIndex(stations: readonly StationRef[]): StationIndex {
  const family = new Map<string, StationRef[]>();
  const exact = new Map<string, StationRef[]>();
  for (const s of stations) {
    if (!s.state || !s.storeNumber) continue;
    if (FAMILY.has(s.brand)) push(family, `${s.storeNumber}|${s.state}`, s);
    push(exact, `${s.brand}|${s.storeNumber}|${s.state}`, s);
  }
  return { family, exact, stations: stations.length };
}

/**
 * Store-number spellings to try, in order. Raw first — see the header; the padded forms only matter
 * when the vendor prints `305` and the registry stored `0305`.
 */
export function storeNumberVariants(n: string): string[] {
  const stripped = n.replace(/^0+(?=\d)/, "");
  return [...new Set([n, stripped, stripped.padStart(3, "0"), stripped.padStart(4, "0")])];
}

export function matchFillStation(
  index: StationIndex,
  locationText: string | null,
  state: string | null,
): StationMatch {
  const id = parseStationIdentity(locationText, null, state);
  if (!id.brand) return { stationId: null, brand: null, reason: "no_brand", key: null };
  if (!id.storeNumber) return { stationId: null, brand: id.brand, reason: "no_store", key: null };
  if (!state) return { stationId: null, brand: id.brand, reason: "no_state", key: null };

  const inFamily = FAMILY.has(id.brand);
  for (const v of storeNumberVariants(id.storeNumber)) {
    const hits = inFamily ? index.family.get(`${v}|${state}`) : index.exact.get(`${id.brand}|${v}|${state}`);
    if (!hits || hits.length === 0) continue;
    const distinct = [...new Map(hits.map((h) => [h.id, h])).values()];
    if (distinct.length > 1) {
      return { stationId: null, brand: id.brand, reason: "ambiguous", key: `${id.brand}#${v} ${state}` };
    }
    const hit = distinct[0]!;
    // The registry's brand wins over the one EFS printed — that is the whole point of the family match.
    return { stationId: hit.id, brand: hit.brand, reason: inFamily ? "family" : "brand", key: `${v}|${state}` };
  }
  return { stationId: null, brand: id.brand, reason: "unmatched", key: `${id.brand}#${id.storeNumber} ${state}` };
}
