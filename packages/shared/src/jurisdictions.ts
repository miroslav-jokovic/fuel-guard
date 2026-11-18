/**
 * The licensing and address jurisdictions — one catalogue, for every field that holds a state code
 * (APPLY-EXPERIENCE-PLAN D-AX5).
 *
 * ── WHY THIS EXISTS RATHER THAN A THIRD `maxlength="2"` TEXT BOX ──────────────────────────────
 * Three fields in the driver's application hold one of these: where they have lived, where they have
 * worked, and which state issued their licence. All three were free text capped at two characters,
 * so `il`, `Il`, `I1` and an empty string were all accepted and all different, on a document a
 * carrier later has to match against a PSP request and an MVR pull — both of which key on the
 * licence's issuing state. A typo there is not a cosmetic defect; it is a screening request that
 * comes back empty for a driver who is perfectly qualified.
 *
 * ── AND WHY IT IS HERE RATHER THAN BESIDE ITS FIRST CALLER ────────────────────────────────────
 * ⚠ There was already a list, and finding it is the whole argument for this file.
 * `samsara/location.ts` has held a private `US_STATES` Set since the Samsara address parser was
 * written — the same 65 codes, with no names, not exported, and unreachable from a browser app
 * because `check-shared-contracts.mjs` forbids value-importing a vendor module from `apps/web`.
 * A second copy in the apply feature would have been the cheapest possible change and the exact
 * shape this repository's "no workarounds" rule names: *a value copied instead of derived*.
 * So the catalogue moves here, where both can read it, and `location.ts` now derives its Set from
 * this array rather than restating it.
 *
 * ── WHAT IS IN IT, AND WHY CANADA IS ──────────────────────────────────────────────────────────
 * The fifty states, the District of Columbia, Puerto Rico, and the thirteen Canadian provinces and
 * territories. Canada is not decoration: cross-border drivers hold provincial commercial licences,
 * §391.21(b)(3) asks where the applicant has LIVED without caring which country, and the set this
 * replaces already carried them — dropping them here would have been a silent narrowing of a list
 * the Samsara parser depends on.
 *
 * ── WHAT IS DELIBERATELY NOT DONE ─────────────────────────────────────────────────────────────
 * ⚠ `applicationAddressSchema.state` and `applicationEmployerSchema.state` are NOT narrowed to this
 * enum, and that is a decision rather than an omission. `driver_applications.payload` is append-only
 * historical jsonb; a schema that refuses a value some older row contains is a qualification file
 * that cannot be re-rendered, which is the §390.32(d) reproducibility failure the renderer exists to
 * prevent. The UI can only PRODUCE a code — that is where the precision belongs — and the schema
 * stays able to READ whatever is already filed. `toJurisdictionCode` is the bridge between the two.
 */

export interface Jurisdiction {
  /** The two-letter code, which is what every field stores and every vendor expects. */
  code: string;
  name: string;
  country: "US" | "CA";
  /**
   * The Census Bureau's two-digit state code (FIPS / ANSI INCITS 38), copied 2026-11-18 from
   * https://www2.census.gov/geo/docs/reference/state.txt for every US entry that file lists. Federal data
   * series are keyed by it — the BLS wage series the ads market evidence reads (ADS-PLATFORM-V2-PLAN D-AD35)
   * name a state by it — so it lives on the one catalogue rather than in a second list of states.
   */
  fips?: string;
}

/**
 * ⚠ In display order, not alphabetical-by-code: US states by name, then the two federal districts
 * and territories, then Canada. A driver scrolling for "Illinois" is looking for a word, and the
 * ninety-nine per cent case should not have to scroll past Alberta to reach it.
 */
export const JURISDICTIONS: readonly Jurisdiction[] = [
  { code: "AL", name: "Alabama", country: "US", fips: "01" },
  { code: "AK", name: "Alaska", country: "US", fips: "02" },
  { code: "AZ", name: "Arizona", country: "US", fips: "04" },
  { code: "AR", name: "Arkansas", country: "US", fips: "05" },
  { code: "CA", name: "California", country: "US", fips: "06" },
  { code: "CO", name: "Colorado", country: "US", fips: "08" },
  { code: "CT", name: "Connecticut", country: "US", fips: "09" },
  { code: "DE", name: "Delaware", country: "US", fips: "10" },
  { code: "FL", name: "Florida", country: "US", fips: "12" },
  { code: "GA", name: "Georgia", country: "US", fips: "13" },
  { code: "HI", name: "Hawaii", country: "US", fips: "15" },
  { code: "ID", name: "Idaho", country: "US", fips: "16" },
  { code: "IL", name: "Illinois", country: "US", fips: "17" },
  { code: "IN", name: "Indiana", country: "US", fips: "18" },
  { code: "IA", name: "Iowa", country: "US", fips: "19" },
  { code: "KS", name: "Kansas", country: "US", fips: "20" },
  { code: "KY", name: "Kentucky", country: "US", fips: "21" },
  { code: "LA", name: "Louisiana", country: "US", fips: "22" },
  { code: "ME", name: "Maine", country: "US", fips: "23" },
  { code: "MD", name: "Maryland", country: "US", fips: "24" },
  { code: "MA", name: "Massachusetts", country: "US", fips: "25" },
  { code: "MI", name: "Michigan", country: "US", fips: "26" },
  { code: "MN", name: "Minnesota", country: "US", fips: "27" },
  { code: "MS", name: "Mississippi", country: "US", fips: "28" },
  { code: "MO", name: "Missouri", country: "US", fips: "29" },
  { code: "MT", name: "Montana", country: "US", fips: "30" },
  { code: "NE", name: "Nebraska", country: "US", fips: "31" },
  { code: "NV", name: "Nevada", country: "US", fips: "32" },
  { code: "NH", name: "New Hampshire", country: "US", fips: "33" },
  { code: "NJ", name: "New Jersey", country: "US", fips: "34" },
  { code: "NM", name: "New Mexico", country: "US", fips: "35" },
  { code: "NY", name: "New York", country: "US", fips: "36" },
  { code: "NC", name: "North Carolina", country: "US", fips: "37" },
  { code: "ND", name: "North Dakota", country: "US", fips: "38" },
  { code: "OH", name: "Ohio", country: "US", fips: "39" },
  { code: "OK", name: "Oklahoma", country: "US", fips: "40" },
  { code: "OR", name: "Oregon", country: "US", fips: "41" },
  { code: "PA", name: "Pennsylvania", country: "US", fips: "42" },
  { code: "RI", name: "Rhode Island", country: "US", fips: "44" },
  { code: "SC", name: "South Carolina", country: "US", fips: "45" },
  { code: "SD", name: "South Dakota", country: "US", fips: "46" },
  { code: "TN", name: "Tennessee", country: "US", fips: "47" },
  { code: "TX", name: "Texas", country: "US", fips: "48" },
  { code: "UT", name: "Utah", country: "US", fips: "49" },
  { code: "VT", name: "Vermont", country: "US", fips: "50" },
  { code: "VA", name: "Virginia", country: "US", fips: "51" },
  { code: "WA", name: "Washington", country: "US", fips: "53" },
  { code: "WV", name: "West Virginia", country: "US", fips: "54" },
  { code: "WI", name: "Wisconsin", country: "US", fips: "55" },
  { code: "WY", name: "Wyoming", country: "US", fips: "56" },
  { code: "DC", name: "District of Columbia", country: "US", fips: "11" },
  { code: "PR", name: "Puerto Rico", country: "US", fips: "72" },
  { code: "AB", name: "Alberta", country: "CA" },
  { code: "BC", name: "British Columbia", country: "CA" },
  { code: "MB", name: "Manitoba", country: "CA" },
  { code: "NB", name: "New Brunswick", country: "CA" },
  { code: "NL", name: "Newfoundland and Labrador", country: "CA" },
  { code: "NS", name: "Nova Scotia", country: "CA" },
  { code: "NT", name: "Northwest Territories", country: "CA" },
  { code: "NU", name: "Nunavut", country: "CA" },
  { code: "ON", name: "Ontario", country: "CA" },
  { code: "PE", name: "Prince Edward Island", country: "CA" },
  { code: "QC", name: "Quebec", country: "CA" },
  { code: "SK", name: "Saskatchewan", country: "CA" },
  { code: "YT", name: "Yukon", country: "CA" },
];

/** Every code, for a membership test. What `samsara/location.ts` used to hold its own copy of. */
export const JURISDICTION_CODES: ReadonlySet<string> = new Set(JURISDICTIONS.map((j) => j.code));

export const isJurisdictionCode = (value: unknown): value is string =>
  typeof value === "string" && JURISDICTION_CODES.has(value.toUpperCase());

const BY_NAME = new Map(JURISDICTIONS.map((j) => [j.name.toLowerCase(), j.code]));

/**
 * Whatever is already stored, as the code this product stores.
 *
 * ⚠ **This exists for RESTORE, and dropping it would lose a driver's answer without saying so.**
 * A saved draft was written when these fields were free text, so it can hold `Illinois`, `illinois`
 * or `il`. A picker handed any of those finds no matching option and renders empty — the driver
 * comes back to a form that has quietly forgotten where they live, and the only evidence is a blank
 * box they already filled in once.
 *
 * Returns null rather than the input for anything it cannot place, so a caller decides what an
 * unplaceable value means instead of inheriting a silent passthrough.
 */
export function toJurisdictionCode(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  const upper = trimmed.toUpperCase();
  if (JURISDICTION_CODES.has(upper)) return upper;
  return BY_NAME.get(trimmed.toLowerCase()) ?? null;
}

export const jurisdictionName = (code: string | null | undefined): string | null =>
  JURISDICTIONS.find((j) => j.code === (code ?? "").toUpperCase())?.name ?? null;

/**
 * The options a picker is given — `"Illinois (IL)"`, so typing either half finds it.
 *
 * The code is in the LABEL and not only in the value because that is what a driver types. A list
 * whose labels are names alone cannot be reached by someone who thinks of their state as two
 * letters, which is how every one of these fields was filled in before there was a list at all.
 */
export const jurisdictionOptions = (): Array<{ value: string; label: string }> =>
  JURISDICTIONS.map((j) => ({ value: j.code, label: `${j.name} (${j.code})` }));
