/** EFS station identity, unit/driver matching, reconciliation + reject normalization. */
import type { Vehicle, Driver } from "../fleet.js";
import type { RawRow, ParsedFuelLine, ParsedDeclined, SkippedRow } from "./types.js";
import type { ReconciledFuelLine } from "./parse.js";
import type { EfsInstant } from "./dateTime.js";
import { str, num, efsInstant, rejectDateToIso } from "./dateTime.js";
import { pick } from "./parse.js";

/** Known truck-stop chains, matched against the EFS Location Name. Order matters (Flying J before J). */
const STATION_BRANDS: { key: string; label: string; patterns: RegExp[] }[] = [
  { key: "flying_j", label: "Flying J", patterns: [/\bflying\s*j\b/i, /\bflyingj\b/i] },
  { key: "pilot", label: "Pilot", patterns: [/\bpilot\b/i] },
  { key: "loves", label: "Love's", patterns: [/\blove'?s\b/i] },
  { key: "ta", label: "TA", patterns: [/\bta\b/i, /\btravelcenters?\b/i, /\btravel\s*centers?\s*of\s*america\b/i] },
  { key: "petro", label: "Petro", patterns: [/\bpetro\b/i] },
];

export interface StationIdentity {
  /** Chain key (pilot, flying_j, loves, ta, petro) or null for independents. */
  brand: string | null;
  brandLabel: string | null;
  /** Store number embedded in the Location Name (e.g. "PILOT JAMESTOWN 305" → "305"). */
  storeNumber: string | null;
  /** Stable cache key. brand+store# is unique nationwide; else falls back to name|city|state. */
  siteKey: string;
  /** Human label for logs / evidence. */
  label: string;
}

const clean = (s: string | null | undefined) => (s ?? "").trim();

/**
 * Extract a stable station identity from the EFS Location Name (+ city/state). Truck-stop names carry
 * the brand and a nationwide-unique store number ("PILOT JAMESTOWN 305"), which lets us key a fuel-site
 * cache precisely instead of fuzzy-matching a city. Pure + testable.
 */
export function parseStationIdentity(
  name: string | null,
  city: string | null,
  state: string | null,
): StationIdentity {
  const n = clean(name);
  const brand = STATION_BRANDS.find((b) => b.patterns.some((p) => p.test(n))) ?? null;
  // Store number = the last standalone number in the name (chains print it after the city).
  const storeNumber = (n.match(/(?:^|\s|#)(\d{1,5})(?:\s|$)/g)?.pop()?.match(/\d{1,5}/)?.[0]) ?? null;

  const c = clean(city).toLowerCase();
  const st = clean(state).toLowerCase();
  const siteKey =
    brand && storeNumber
      ? `${brand.key}#${storeNumber}` // globally unique per chain
      : [n.toLowerCase(), c, st].filter(Boolean).join("|") || "unknown";

  const label = [brand?.label ?? n, city, state].filter(Boolean).join(" · ") || "Unknown site";
  return { brand: brand?.key ?? null, brandLabel: brand?.label ?? null, storeNumber, siteKey, label };
}

/**
 * Unit match keys: exact-normalized (alnum, lowercased) plus a leading-zeros-stripped variant, so
 * "0042", "42", and "Unit 42" all line up. Returns the distinct keys to index/look up by.
 */
export function unitMatchKeys(unit: string): string[] {
  const base = unit.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!base) return [];
  const noLeadingZeros = base.replace(/^0+(?=\d)/, "");
  return [...new Set([base, noLeadingZeros])];
}

/**
 * Driver match key: order-independent, punctuation-insensitive, middle-initial-tolerant. Splits into
 * alphabetic tokens, drops single-letter tokens (initials like "J."), sorts, and joins — so
 * "SMITH, JOHN", "John Smith", and "John A. Smith" all collapse to "john smith".
 */
export function driverMatchKey(name: string | null | undefined): string {
  if (!name) return "";
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return tokens.sort().join(" ");
}

/** Build a lookup that maps each key to a single id, marking keys shared by 2+ records as ambiguous. */
function buildKeyIndex(entries: { id: string; keys: string[] }[]): Map<string, string | null> {
  const idx = new Map<string, string | null>();
  for (const { id, keys } of entries) {
    for (const k of keys) {
      if (!k) continue;
      if (idx.has(k)) idx.set(k, null); // collision → ambiguous, don't guess
      else idx.set(k, id);
    }
  }
  return idx;
}

/**
 * Resolve each fuel line's Unit → vehicle and Driver Name → driver (pure, testable). Matching is
 * tolerant of formatting differences ("LAST, FIRST" vs "First Last", casing, punctuation, leading
 * zeros, middle initials). Ambiguous keys (shared by 2+ records) stay unmatched rather than guess.
 * Unmatched vehicle ⇒ vehicle_id null (the row is "unattributed"); we no longer flag that as an anomaly.
 */
/**
 * Which EFS driver names have NO matching driver record and are safe to AUTO-CREATE so the fill can be
 * attributed. Deduped by the same normalized match key the matcher uses (so "SMITH, JOHN" and "John Smith"
 * produce ONE driver), and requires a plausible full name (≥2 alphabetic tokens) so junk like a blank, a
 * single word, or "DRIVER" is skipped. Returns the canonical (first-seen) name to store for each.
 */
export function driversToProvision(names: (string | null)[], existing: Pick<Driver, "full_name">[]): string[] {
  const have = new Set<string>();
  for (const d of existing) {
    const k = driverMatchKey(d.full_name);
    if (k) have.add(k);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (!raw) continue;
    const name = raw.trim();
    const key = driverMatchKey(name);
    if (!key || key.split(" ").length < 2) continue; // need first + last, at least
    if (have.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function reconcileFuelLines(
  lines: ParsedFuelLine[],
  vehicles: Pick<Vehicle, "id" | "unit_number">[],
  drivers: Pick<Driver, "id" | "full_name">[],
): ReconciledFuelLine[] {
  const byUnit = buildKeyIndex(vehicles.map((v) => ({ id: v.id, keys: unitMatchKeys(v.unit_number) })));
  const byName = buildKeyIndex(drivers.map((d) => ({ id: d.id, keys: [driverMatchKey(d.full_name)] })));

  const matchUnit = (unit: string | null): string | null => {
    if (!unit) return null;
    for (const k of unitMatchKeys(unit)) {
      const hit = byUnit.get(k);
      if (hit) return hit;
    }
    return null;
  };
  const matchDriver = (name: string | null): string | null => {
    if (!name) return null;
    return byName.get(driverMatchKey(name)) ?? null;
  };

  return lines.map((line) => ({
    ...line,
    vehicle_id: matchUnit(line.unit),
    driver_id: matchDriver(line.driver_name),
  }));
}

/**
 * Normalize Reject Report rows into declined-attempt records. Rows whose date can't be parsed are
 * QUARANTINED to `skipped` — we never fabricate an import-time timestamp for a decline (it would
 * corrupt the decline timeline used by the theft scoring). Refs are date-scoped like transactions.
 */
export function normalizeRejectRows(rows: RawRow[]): {
  declined: ParsedDeclined[];
  skipped: SkippedRow[];
} {
  const declined: ParsedDeclined[] = [];
  const skipped: SkippedRow[] = [];
  rows.forEach((row, i) => {
    const card = str(pick(row, "Card Number", "Card #"));
    const invoice = str(pick(row, "Invoice"));
    const code = str(pick(row, "Error Code", "Reject Code", "Reject Reason", "Decline Reason", "Decline Code", "Reason Code", "Response Code"));
    const state = str(pick(row, "State/Prov", "State/ Prov", "State", "Location State"));
    const instant =
      efsInstant(
        str(pick(row, "Date", "Tran Date", "TransactionPOSDate")),
        str(pick(row, "Time", "TransactionPOSTime", "POS Time")),
        state,
      ) ?? rejectInstant(str(pick(row, "Date", "Time")), state);
    if (!instant) {
      skipped.push({ row_number: i + 1, reason: "unparseable date" });
      return;
    }
    declined.push({
      external_ref: [card ?? "", invoice ?? "", code ?? "", instant.tranDate].join("|"),
      declined_at: instant.iso,
      card_ref: card,
      invoice,
      location_id: str(pick(row, "Location ID")),
      unit: str(pick(row, "Unit")),
      driver_ext_id: str(pick(row, "Driver ID")),
      driver_name: str(pick(row, "Driver Name")),
      location_text: str(pick(row, "Location Name")),
      city: str(pick(row, "Location City", "City")),
      state,
      error_code: code,
      error_description: str(pick(row, "Error Description", "Reject Description", "Reject Reason", "Reason", "Response", "Description")),
      policy: str(pick(row, "Policy")),
      policy_name: str(pick(row, "Policy Name")),
      // WP1 D3 — OPTIONAL EFS alert fields. The standard RejectTransactionReport does NOT carry them
      // (verified: 15 columns); some variants / the EFS alert may. Captured faithfully when present,
      // and nothing downstream depends on them.
      card_assigned_unit: str(pick(row, "Truck", "Truck Number", "Tractor", "Vehicle", "Assigned Truck")),
      efs_proximity_miles: num(pick(row, "Proximity", "Proximity Miles", "Distance", "Distance Miles", "Miles")),
      efs_truck_position_at: str(pick(row, "Truck Location Time", "Truck Position Time", "Position Time")),
    });
  });
  return { declined, skipped };
}

/** A declined row's attribution result (WP1 D2). */
export interface DeclineAttribution {
  vehicle_id: string | null;
  driver_id: string | null;
}

/**
 * WP1 D2 — attribute a declined row to a vehicle (pump Unit) and driver (EFS Driver ID, else name),
 * with EXACTLY the same tolerance + ambiguity rules as the fuel-line reconciliation (unitMatchKeys /
 * driverMatchKey; collisions never guess). This is what revives the decline location check — the
 * schema has had declined_transactions.vehicle_id since migration 0007, but ingest never set it, so
 * the Samsara "was the truck there?" check was dead code. Pure.
 */
export function attributeDeclinedRow(
  row: { unit: string | null; driver_ext_id: string | null; driver_name: string | null },
  vehicles: Pick<Vehicle, "id" | "unit_number">[],
  drivers: (Pick<Driver, "id" | "full_name"> & { efs_driver_id?: string | null })[],
): DeclineAttribution {
  const byUnit = buildKeyIndex(vehicles.map((v) => ({ id: v.id, keys: unitMatchKeys(v.unit_number) })));
  const byName = buildKeyIndex(drivers.map((d) => ({ id: d.id, keys: [driverMatchKey(d.full_name)] })));
  const byExt = buildKeyIndex(
    drivers.filter((d) => d.efs_driver_id).map((d) => ({ id: d.id, keys: [(d.efs_driver_id as string).trim()] })),
  );

  let vehicle_id: string | null = null;
  if (row.unit) {
    for (const k of unitMatchKeys(row.unit)) {
      const hit = byUnit.get(k);
      if (hit) {
        vehicle_id = hit;
        break;
      }
    }
  }
  // Driver: the stable EFS numeric id wins (same identity as the transaction report's DriverId);
  // fall back to the tolerant name match.
  let driver_id: string | null = null;
  if (row.driver_ext_id) driver_id = byExt.get(row.driver_ext_id.trim()) ?? null;
  if (!driver_id && row.driver_name) driver_id = byName.get(driverMatchKey(row.driver_name)) ?? null;

  return { vehicle_id, driver_id };
}

/**
 * WP1 D5 — learn the EFS numeric driver identity (transaction "DriverId" == reject "Driver ID") for
 * each matched driver. Returns ext-id → driver_id ONLY when the pairing is CONSISTENT across the
 * import (an ext id seen with 2+ different matched drivers, or a driver seen with 2+ ext ids, is
 * dropped — never guess an identity). Pure; the API upserts the result onto drivers.efs_driver_id.
 */
export function learnEfsDriverIds(pairs: { driverExtId: string | null; driverId: string | null }[]): Map<string, string> {
  const byExt = new Map<string, Set<string>>();
  const byDriver = new Map<string, Set<string>>();
  for (const p of pairs) {
    const ext = (p.driverExtId ?? "").trim();
    if (!ext || !p.driverId) continue;
    (byExt.get(ext) ?? byExt.set(ext, new Set()).get(ext)!).add(p.driverId);
    (byDriver.get(p.driverId) ?? byDriver.set(p.driverId, new Set()).get(p.driverId)!).add(ext);
  }
  const out = new Map<string, string>();
  for (const [ext, drivers] of byExt) {
    if (drivers.size !== 1) continue; // ambiguous ext id → skip
    const driverId = [...drivers][0]!;
    if ((byDriver.get(driverId)?.size ?? 0) !== 1) continue; // driver claims 2+ ext ids → skip
    out.set(ext, driverId);
  }
  return out;
}

/** Fallback for Reject Reports with a combined "YYYY-MM-DD HH:mm:ss" cell — station-local, tz-aware. */
function rejectInstant(date: string | null, state: string | null): EfsInstant | null {
  const iso = rejectDateToIso(date);
  if (!iso) return null;
  // rejectDateToIso treated the naive wall time as UTC; re-derive via efsInstant for tz correctness.
  const s = str(date);
  if (s) {
    const viaEfs = efsInstant(s, null, state);
    if (viaEfs?.precision === "instant") return viaEfs;
  }
  return { iso, precision: "instant", tranDate: iso.slice(0, 10) };
}
