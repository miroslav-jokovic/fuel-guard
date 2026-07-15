/**
 * Provider seams for productization (pure contracts). v1 implements only the Pilot station export + the Pilot
 * daily-price email; other carriers plug in different sources without touching the sync/solver. The concrete
 * PARSERS are built against REAL sample files (Phase 1b) — never a guessed format.
 */

/** One station as produced by a StationSource (chain-agnostic). */
export interface StationRecord {
  brand: string;
  storeNumber: string | null;
  name: string | null;
  lat: number;
  lng: number;
  state: string | null;
  exit: string | null;
  hasDiesel: boolean;
  hasDef: boolean;
  status?: "active" | "closed";
}

/** One price row as produced by a PriceSource (keyed to a station by brand+storeNumber). */
export interface PriceRecord {
  brand: string;
  storeNumber: string | null;
  product: "diesel" | "def";
  postedPrice: number | null;
  netPrice: number | null;
  observedAt: string; // ISO
}

/** A pluggable station registry (e.g. Pilot "Download All Locations", OSM, another chain's API). */
export interface StationSource {
  readonly name: string;
  fetch(): Promise<StationRecord[]>;
}

/** A pluggable price feed (e.g. Pilot daily email, a chain API, OPIS). Returns a completeness signal for QA. */
export interface PriceFetchResult {
  rows: PriceRecord[];
  /** Rows the source reported vs. parsed — lets the ingest detect silent partial-parse drops (audit H8). */
  expectedRows: number | null;
}
export interface PriceSource {
  readonly name: string;
  fetch(): Promise<PriceFetchResult>;
}
