/** US state/city/address normalization + wall-time-to-UTC approximation. */

const US_STATES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
  "PR",
  // Canadian provinces (EFS fleets often cross the border)
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]);

/** Full state/province NAME → 2-letter code, so an EFS value that arrives as a full name ("Texas",
 *  "British Columbia") still compares equal to Samsara's 2-letter reverse-geo code and can't cause a
 *  false location mismatch. */
const STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
  "PUERTO RICO": "PR",
  // Canadian provinces/territories
  ALBERTA: "AB",
  "BRITISH COLUMBIA": "BC",
  MANITOBA: "MB",
  "NEW BRUNSWICK": "NB",
  "NEWFOUNDLAND AND LABRADOR": "NL",
  NEWFOUNDLAND: "NL",
  "NOVA SCOTIA": "NS",
  "NORTHWEST TERRITORIES": "NT",
  NUNAVUT: "NU",
  ONTARIO: "ON",
  "PRINCE EDWARD ISLAND": "PE",
  QUEBEC: "QC",
  SASKATCHEWAN: "SK",
  YUKON: "YT",
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

