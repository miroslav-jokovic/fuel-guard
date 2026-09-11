/** US state/city/address normalization + wall-time-to-UTC approximation. */

import { JURISDICTIONS, JURISDICTION_CODES } from "../jurisdictions.js";

/**
 * ⚠ **Both of these used to be written out here, and they are now DERIVED from the one catalogue.**
 *
 * This file held 65 two-letter codes and, below them, a 66-entry name-to-code map — the only list of
 * US and Canadian jurisdictions in the repository, private to a vendor parser and unreachable from a
 * browser app (`check-shared-contracts.mjs` forbids `apps/web` value-importing anything under
 * `packages/shared/src/samsara`). When the driver application needed the same list for its three
 * state fields, copying it would have been the cheapest change available and exactly the shape this
 * repository's "no workarounds" rule names: a value copied instead of derived, with no way for
 * anyone to notice the two drifting apart.
 *
 * `jurisdictions.ts` is that catalogue. Nothing about this parser's behaviour changes — the derived
 * set is the same 65 codes and the derived map the same 65 names — which is pinned by
 * "derives the same 65 codes and names the Samsara parser used to write out by hand".
 */
const US_STATES = JURISDICTION_CODES;

/** Full state/province NAME → 2-letter code, so an EFS value that arrives as a full name ("Texas",
 *  "British Columbia") still compares equal to Samsara's 2-letter reverse-geo code and can't cause a
 *  false location mismatch. */
const STATE_NAME_TO_CODE: Record<string, string> = {
  ...Object.fromEntries(JURISDICTIONS.map((j) => [j.name.toUpperCase(), j.code])),
  /**
   * ⚠ The one entry that is NOT a canonical name and therefore cannot be derived. The province is
   * "Newfoundland and Labrador"; EFS statements write "Newfoundland", and an alias dropped in a
   * refactor would turn a matched location into an unknown one silently.
   */
  NEWFOUNDLAND: "NL",
};

/**
 * Normalize a state/province value to its 2-letter US/CA code. Accepts a code ("TX", "tx") OR a full name
 * ("Texas", "TEXAS", "British Columbia"). Returns null when unrecognized — fail-safe: no code means no state
 * comparison, which yields "unknown" (never a false mismatch). Use this on any EFS-provided state before
 * comparing it to a Samsara reverse-geo code.
 */
export function normalizeStateCode(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim().toUpperCase();
  if (US_STATES.has(t)) return t;
  return STATE_NAME_TO_CODE[t] ?? null;
}

/** Extract the 2-letter state/province code from a Samsara formatted address ("…, City, ST, 12345"). */
export function stateFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const tokens = address.split(",").map((s) => s.trim());
  for (let i = tokens.length - 1; i >= 0; i--) {
    const m = tokens[i]!.match(/\b([A-Za-z]{2})\b/);
    if (m && US_STATES.has(m[1]!.toUpperCase())) return m[1]!.toUpperCase();
  }
  return null;
}

/** Extract the city (token just before the state) from a Samsara formatted address. */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const tokens = address.split(",").map((s) => s.trim());
  for (let i = tokens.length - 1; i >= 0; i--) {
    const m = tokens[i]!.match(/\b([A-Za-z]{2})\b/);
    if (m && US_STATES.has(m[1]!.toUpperCase())) return i > 0 ? tokens[i - 1]! : null;
  }
  return null;
}

/**
 * Compare the EFS station state to the Samsara address state at the fueling moment.
 * Returns true (same state), false (clearly different state → mismatch), or null (can't tell).
 */
export function compareLocationState(
  efsState: string | null,
  samsaraAddress: string | null,
): boolean | null {
  if (!efsState || !samsaraAddress) return null;
  const s = stateFromAddress(samsaraAddress);
  const efs = normalizeStateCode(efsState);
  if (!s || !efs) return null;
  return s === efs;
}

// Hours to ADD to local time to get UTC (standard time; DST ignored → ≤1h slack, absorbed by the
// matching window). Used only to APPROXIMATE the fueling instant so we can pick the right stop — the
// odometer/location itself comes from the physical Samsara stop, so this never has to be exact.
const STATE_UTC_OFFSET: Record<string, number> = {
  // Eastern
  CT: 5,
  DE: 5,
  FL: 5,
  GA: 5,
  IN: 5,
  MA: 5,
  MD: 5,
  ME: 5,
  MI: 5,
  NC: 5,
  NH: 5,
  NJ: 5,
  NY: 5,
  OH: 5,
  PA: 5,
  RI: 5,
  SC: 5,
  VA: 5,
  VT: 5,
  WV: 5,
  DC: 5,
  ON: 5,
  QC: 5,
  // Atlantic (Canada)
  NB: 4,
  NS: 4,
  PE: 4,
  NL: 4,
  // Central
  AL: 6,
  AR: 6,
  IA: 6,
  IL: 6,
  KS: 6,
  LA: 6,
  MN: 6,
  MO: 6,
  MS: 6,
  ND: 6,
  NE: 6,
  OK: 6,
  SD: 6,
  TN: 6,
  TX: 6,
  WI: 6,
  MB: 6,
  // Mountain
  AZ: 7,
  CO: 7,
  ID: 7,
  MT: 7,
  NM: 7,
  UT: 7,
  WY: 7,
  AB: 7,
  // Pacific
  CA: 8,
  NV: 8,
  OR: 8,
  WA: 8,
  BC: 8,
  AK: 9,
  HI: 10,
};

/**
 * Parse a timestamp as UTC even when it carries no timezone designator. A tz-less ISO string
 * ("2026-06-30T14:30:00") is interpreted as LOCAL time by `new Date`, which makes results depend on
 * the server's timezone — so we append 'Z' when no offset/zone is present to force UTC deterministically.
 */
export function parseAsUtcMs(iso: string): number {
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso.trim());
  return new Date(hasZone ? iso : `${iso}Z`).getTime();
}

/**
 * Approximate the fueling instant (ms, UTC) from a report's naive-UTC time + the station state.
 * @deprecated EFS instants are now converted station-local → true UTC at parse time (efsInstant),
 * so callers should treat `fueled_at` as UTC directly. Kept for legacy data paths/tests only.
 */
export function approxFuelingUtcMs(posNaiveIso: string, state: string | null): number {
  const base = parseAsUtcMs(posNaiveIso);
  const off = state ? STATE_UTC_OFFSET[state.trim().toUpperCase()] : undefined;
  return off != null ? base + off * 3_600_000 : base;
}

