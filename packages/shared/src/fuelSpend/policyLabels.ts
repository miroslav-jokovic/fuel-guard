/**
 * Naming a policy exception report after the policy it actually measures.
 *
 * ── WHY THESE EXIST ──────────────────────────────────────────────────────────────────────────────
 * The compliance tabs were labelled "California" and "ONE9 & off-brand" as literal strings, next to an
 * analyzer whose policy was a hardcoded constant. Both were true of the one carrier the feature was
 * built against and of no other: `route_fuel_settings.avoid_states` is a list, it is editable on the
 * Fuel Planning Settings page, and the route planner has always honoured it. An org that adds Oregon
 * got a planner that avoided Oregon and a report headed "California" that measured only CA.
 *
 * The label is derived from the same list the analyzer selects on, so the two cannot disagree — which
 * is the whole point. `avoidedStatesLabel(policy.avoidStates)` reads the array that
 * `analyzePolicyExceptions` filters with, not a copy of it.
 *
 * ── WHY THE FULL STATE NAMES ARE HERE AND NOT DERIVED ────────────────────────────────────────────
 * A two-letter code is unambiguous and reads as a database value; a tab called "CA" is worse than one
 * called "California" for the reader this page is for. There is no state-name table anywhere in the
 * monorepo (`stateTimeZone` maps codes to zones, not names), so one lives here, beside its only
 * consumer. An unknown code falls back to itself rather than being dropped — a policy naming a state
 * we cannot spell is still a policy we must measure.
 */
import { BRAND_LABELS } from "../smartFueling/brands.js";

/** US states, DC, and the Canadian provinces the fleet's lanes reach. Codes are uppercase. */
export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick",
  NL: "Newfoundland and Labrador", NS: "Nova Scotia", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec", SK: "Saskatchewan",
};

/** "California", "California and Oregon", "California, Oregon and 2 more". Empty list → null. */
export function avoidedStatesLabel(states: readonly string[]): string | null {
  return joinNames(states.map((s) => STATE_NAMES[s.toUpperCase()] ?? s.toUpperCase()));
}

/** "ONE9", "ONE9 and Pride", … using the catalogue's own labels. Empty list → null. */
export function avoidedBrandsLabel(brands: readonly string[]): string | null {
  return joinNames(brands.map((b) => BRAND_LABELS[b.toLowerCase()] ?? b));
}

/**
 * Two names are joined; beyond that the tail is counted rather than listed, because a tab label has to
 * fit on a tab. The full list is always stated in the report's own blurb, which has the room.
 */
function joinNames(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Every name, always — for a blurb or a PDF paragraph, where truncating would hide the policy. */
export function listStates(states: readonly string[]): string {
  return states.map((s) => STATE_NAMES[s.toUpperCase()] ?? s.toUpperCase()).join(", ");
}
