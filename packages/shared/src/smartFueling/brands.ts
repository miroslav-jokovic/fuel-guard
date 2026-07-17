/**
 * Brand catalog for the Pilot Company family (chain-agnostic shape — other chains append here later).
 * Built from the REAL "Download All Locations" export (2026-07 sample, 877 rows, 20 distinct location
 * names): the export's `Name` column carries the sub-brand ("Flying J Cardlock", "ONE9 Dealer", …), which
 * must map to the canonical brand slugs the solver's preferred/avoid/emergency policy and the discount
 * rules already key on (`pilot`, `flying_j`, `one9`, …). Unknown names are NOT silently guessed — the
 * parser flags them so the ingest can report and a human can extend this map.
 */

/** Canonical brand slug -> human label (drives settings UI checkboxes and station listings). */
export const BRAND_LABELS: Record<string, string> = {
  pilot: "Pilot",
  flying_j: "Flying J",
  one9: "ONE9",
  mr_fuel: "Mr. Fuel",
  ez_trip: "EZ Trip",
  xpress_fuel: "Xpress Fuel",
  pride: "Pride",
  stamart: "Stamart",
  arco: "ARCO",
  kwik_trip: "Kwik Trip / Kwik Star",
  road_ranger: "Road Ranger",
  loves: "Love's",
};

/**
 * Brands whose store numbers live in the ONE shared Pilot Company numbering space (store # is unique
 * across the whole family — verified on the 2026-07 export). Price feeds that key rows by store number
 * alone (the daily email, the public price page) must match stations across this whole family, never by
 * a single brand — matching on (brand='pilot', store#) would duplicate a Flying J station.
 * FIXED LIST — deliberately NOT derived from BRAND_LABELS: other networks (Kwik Trip, Road Ranger, …)
 * have their own numbering spaces and must never be matched into the Pilot family.
 */
export const PILOT_FAMILY_BRANDS = [
  "pilot", "flying_j", "one9", "mr_fuel", "ez_trip", "xpress_fuel", "pride", "stamart", "arco",
];

/** Location-name prefix -> brand slug. Order matters: first match wins; longest/most specific first. */
const NAME_TO_BRAND: Array<[RegExp, string]> = [
  [/^shell flying j/i, "flying_j"],
  [/^flying j/i, "flying_j"],
  [/^pilot/i, "pilot"],
  [/^one9/i, "one9"],
  [/^mr\.? fuel/i, "mr_fuel"],
  [/^ez trip/i, "ez_trip"],
  [/^xpress fuel/i, "xpress_fuel"],
  [/^pride/i, "pride"],
  [/^stamart/i, "stamart"],
  [/^arco/i, "arco"],
];

export interface BrandMatch {
  brand: string;
  /** false = the name matched no known family brand; the caller must flag it, not guess. */
  known: boolean;
}

/** Map a locations-export `Name` ("Flying J Cardlock", "ONE9 Dealer", …) to a canonical brand slug. */
export function brandFromLocationName(name: string): BrandMatch {
  const n = name.trim();
  for (const [re, brand] of NAME_TO_BRAND) if (re.test(n)) return { brand, known: true };
  // Fall back to a stable slug of the first word so an unknown sub-brand still gets a deterministic,
  // non-colliding brand value — but marked unknown so the ingest reports it loudly.
  const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "unknown";
  return { brand: slug, known: false };
}
