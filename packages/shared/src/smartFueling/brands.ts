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

/**
 * THE brand catalog — one ordered rule list, consumed by both matchers below, so the two can never
 * drift apart again. They had: the locations export knew ten brands while the EFS transaction path knew
 * five and had never heard of ONE9, which is how $1,045,342 of fuel since 2026-06-01 ended up filed as
 * brandless independents (measured against production `efs_transactions`, 2026-08-24).
 *
 * ORDER IS PRIORITY, not position — the first rule that matches anywhere in the name wins. `flying_j`
 * must stay above `pilot` so "Pilot Flying J" is not read as a Pilot travel center, and `pfj` sits with
 * `pilot` for the same reason in reverse. 57 production names name both chains ("PILOT FJ-BILLINGS DBA
 * TOWN PUMP", "CAT SCALES  FLYING J   PILOT"); they are genuinely ambiguous and this priority is the
 * documented tie-break, not a guess that one is more likely.
 *
 * Patterns are word-anchored on BOTH sides. That is what stops "ARCO" matching inside "MARCO'S" and
 * "ONE 9" matching inside "STONE 9", and it is why `\bfj\b` cannot fire inside "PFJ".
 */
export interface StationBrandRule {
  key: string;
  label: string;
  patterns: RegExp[];
}

export const STATION_BRAND_RULES: StationBrandRule[] = [
  {
    key: "flying_j",
    label: "Flying J",
    // EFS writes Flying J as "FJ-TULSA 706", "FJ 1372", "FJ BIG SPRINGS 904" far more often than in
    // full — 3,295 transactions / $979,773 since 2026-06-01 vs 429 / $102,630 spelled out. A matcher
    // without the abbreviation misses roughly nine Flying J gallons in ten.
    patterns: [/\bshell\s*flying\s*j\b/i, /\bflying\s*j\b/i, /\bflyingj\b/i, /\bfj\b/i],
  },
  // ONE9 sits above `pilot` because it is its own brand in `route_fuel_settings.avoid_brands`, and the
  // whole point of that policy is being able to see when it was used. EFS spells it both closed-up
  // ("ONE9 #1251") and spaced ("ONE 9 1330"); store numbers 61/1251/1330/1426 confirm both as one9.
  { key: "one9", label: "ONE9", patterns: [/\bone\s*9\b/i] },
  { key: "mr_fuel", label: "Mr. Fuel", patterns: [/\bmr\.?\s*fuel\b/i] },
  { key: "ez_trip", label: "EZ Trip", patterns: [/\bez\s*trip\b/i] },
  { key: "xpress_fuel", label: "Xpress Fuel", patterns: [/\bxpress\s*fuel\b/i] },
  { key: "stamart", label: "Stamart", patterns: [/\bstamart\b/i] },
  // START-anchored on purpose. These two are ordinary English words as much as they are brandmarks, so
  // a mid-string match is as likely to be someone else's business name: `\bpride\b` claimed
  // "CAT SCALES  NATIVE PRIDE" — an unrelated chain — as Pilot's Pride. Anchoring keeps them working on
  // the locations export (where the Name column IS the brand) without inventing brands in free text.
  { key: "pride", label: "Pride", patterns: [/^\s*pride\b/i] },
  { key: "arco", label: "ARCO", patterns: [/^\s*arco\b/i] },
  {
    key: "pilot",
    label: "Pilot",
    // "PFJ" is the corporate prefix and is ambiguous from the name alone — Pilot Flying J covers both
    // brands. Mapped to `pilot` because the one shape in production ("PFJ SOUTHEAST 1049") resolves to
    // store 1049, which `fuel_stations` holds as pilot/VA. Where brand precision actually matters, the
    // weekly-statement path joins on (store number, state) instead of reading the name.
    patterns: [/\bpfj\b/i, /\bpilot\b/i],
  },
  { key: "loves", label: "Love's", patterns: [/\blove'?s\b/i] },
  {
    key: "ta",
    label: "TA",
    patterns: [/\btravel\s*centers?\s*of\s*america\b/i, /\btravelcenters?\b/i, /\bta\b/i],
  },
  { key: "petro", label: "Petro", patterns: [/\bpetro\b/i] },
  { key: "road_ranger", label: "Road Ranger", patterns: [/\broad\s*ranger\b/i] },
  { key: "kwik_trip", label: "Kwik Trip / Kwik Star", patterns: [/\bkwik\s*(?:trip|star)\b/i] },
];

export interface StationBrandMatch {
  brand: string;
  label: string;
  /** Index of the first matched character. */
  start: number;
  /** Index just past the matched brand text — the anchor a store number is read forward from. */
  end: number;
}

/**
 * First brand rule that matches anywhere in a free-text station name, with the match's end position.
 * Null for a genuine independent — never a guess, because a wrong brand becomes a wrong `siteKey`.
 */
export function matchStationBrand(name: string): StationBrandMatch | null {
  for (const rule of STATION_BRAND_RULES) {
    for (const p of rule.patterns) {
      const m = p.exec(name);
      if (m) return { brand: rule.key, label: rule.label, start: m.index, end: m.index + m[0].length };
    }
  }
  return null;
}

/** True when the brand rule matched at the very start of the name, ignoring leading punctuation. */
function matchesAtStart(name: string, m: StationBrandMatch): boolean {
  return m.start <= (/^[^A-Za-z0-9]*/.exec(name)?.[0].length ?? 0);
}

export interface BrandMatch {
  brand: string;
  /** false = the name matched no known family brand; the caller must flag it, not guess. */
  known: boolean;
}

/**
 * Map a locations-export `Name` ("Flying J Cardlock", "ONE9 Dealer", …) to a canonical brand slug.
 *
 * Distinct from `matchStationBrand` on purpose: that column is a clean sub-brand LABEL, so the brand is
 * required at the START of it. A free-text EFS name ("CAT SCALES  LONDON TRAVEL PLAZA") must not be read
 * the same way. Same catalog, different anchoring.
 */
export function brandFromLocationName(name: string): BrandMatch {
  const n = name.trim();
  const m = matchStationBrand(n);
  if (m && matchesAtStart(n, m)) return { brand: m.brand, known: true };
  // Fall back to a stable slug of the first word so an unknown sub-brand still gets a deterministic,
  // non-colliding brand value — but marked unknown so the ingest reports it loudly.
  const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "unknown";
  return { brand: slug, known: false };
}
