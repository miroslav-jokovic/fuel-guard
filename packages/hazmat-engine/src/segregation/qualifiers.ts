import { PIH_ASSERTING_PROVISIONS, PIH_CONDITIONAL_PROVISION, PIH_PSN_PATTERN } from "../placards/tableSelect.js";

/**
 * Which row of the §177.848(d) grid a material is (TWO-CLICK-READER-PLAN TC1.1, D-TC8; E1).
 *
 * The grid's rows are not all plain classes. Four are QUALIFIED: "2.3 gas zone A", "2.3 gas Zone B", "6.1 liquids PG I
 * zone A", "8 liquids only". A Division 6.1 material in Packing Group III is not the "6.1 liquids PG I zone A" row and
 * has no row at all — the table puts no restriction on it. Until 2026-10-29 the check matched rows by class NUMBER
 * and took the most severe cell of every row sharing it, so UN1263 paint (3, PG II) beside UN1710 trichloroethylene
 * (6.1, PG III) was a `violation` that blocked the load, on a pair §177.848(d) does not restrict. A violation is a
 * CFR fact about the load, never a worst case over a qualifier the table already answers.
 *
 * Each label's qualifiers are read from its OWN words (phase, PG, zone), and each material's from its HMT row:
 *   - PG: the row's packing group (the line's `hmtRef`).
 *   - Zone: §172.102(c)(1) special provisions 1–4 are hazard zones A–D. A material with none is not zoned — unless
 *     its row may still be an inhalation hazard (provision 5, or a shipping name that says so; the same rule
 *     tableSelect.ts applies to Table 1), in which case its zone is UNKNOWN.
 *   - Phase, a fact of the MATERIAL whichever of its hazards is being placed: a material whose primary class is 2 is
 *     a gas — its subsidiary 8 is a corrosive gas, never the "8 liquids only" row. Otherwise the shipping name's own
 *     word ("solid", "liquid", "solution" — "Solids containing corrosive liquid" is a solid), then column 9's quantity
 *     limits are in litres for a liquid and kilograms for a solid — measured on 2026.07.1, that decides 367 of 386
 *     Class 8 rows, where the shipping name names a phase on 67 — and a hazard zone on a material that is not a gas
 *     implies a liquid: zones are assigned only to gases (§173.116(a)) and the vapour of liquids (§173.133(a)), so
 *     bromine solutions (8, zone A) is a liquid where column 9 says "Forbidden". Else UNKNOWN.
 * A label matches `yes`, `no`, or `unknown` when a qualifier it names is unknown for this material.
 */
export type Match = "yes" | "no" | "unknown";

interface Row { pg?: string | null; specialProvisions?: string[]; quantityLimits?: Record<string, string | null> | null }
export interface QualifierEntry { psnPrinted?: string; hazardClass?: string | null; pgRows?: Row[] }

export interface MaterialFacts {
  pg: string | null;
  /** "A"–"D", "none" (not an inhalation hazard), or null (cannot be told from the row). */
  zone: string | null;
  /** "gas" | "liquid" | "solid", or null (cannot be told from the row). */
  phase: string | null;
}

const ZONE_OF_PROVISION: Record<string, string> = { "1": "A", "2": "B", "3": "C", "4": "D" };

export function factsOf(entry: QualifierEntry, baseClass: string, pg: string | null): MaterialFacts {
  const rows = entry.pgRows ?? [];
  const row = rows.find((r) => (r.pg ?? null) === pg) ?? rows[0];
  const sps = new Set(row?.specialProvisions ?? []);
  const zones = [...PIH_ASSERTING_PROVISIONS].filter((sp) => sps.has(sp)).map((sp) => ZONE_OF_PROVISION[sp]!);
  const maybeInhalation = sps.has(PIH_CONDITIONAL_PROVISION) || PIH_PSN_PATTERN.test(entry.psnPrinted ?? "");
  // Division 2.3 is poison gas by definition: with no zone provision its zone is unknown, never "none".
  const zone = zones.length === 1 ? zones[0]! : zones.length > 1 || maybeInhalation || baseClass === "2.3" ? null : "none";

  let phase: string | null = null;
  if (/^2(\.|$)/.test(baseClass) || /^2(\.|$)/.test((entry.hazardClass ?? "").trim())) phase = "gas";
  else if (/\bsolids?\b/i.test(entry.psnPrinted ?? "")) phase = "solid";
  else if (/\b(liquids?|solutions?)\b/i.test(entry.psnPrinted ?? "")) phase = "liquid";
  else {
    const units = new Set<string>();
    for (const v of Object.values(row?.quantityLimits ?? {})) {
      const m = /\b(m?L|k?g)\b/.exec(v ?? "");
      if (m) units.add(/L$/.test(m[1]!) ? "liquid" : "solid");
    }
    if (units.size === 1) phase = [...units][0]!;
    else if (units.size === 0 && zone !== null && zone !== "none") phase = "liquid";
  }
  return { pg: row?.pg ?? pg ?? null, zone, phase };
}

interface LabelQualifiers { phase: string | null; pg: string | null; zone: string | null }

/** A grid label's own words: "6.1 liquids PG I zone A" → liquid, I, A; "8 liquids only" → liquid; "3" → nothing. */
export function qualifiersOf(label: string): LabelQualifiers {
  const phase = /\bliquids?\b/i.test(label) ? "liquid" : /\bsolids?\b/i.test(label) ? "solid" : /\bgas(es)?\b/i.test(label) ? "gas" : null;
  const pg = /\bPG\s+(III|II|I)\b/i.exec(label)?.[1]?.toUpperCase() ?? null;
  const zone = /\bzone\s+([A-D])\b/i.exec(label)?.[1]?.toUpperCase() ?? null;
  return { phase, pg, zone };
}

/** Does this material sit on this grid row? Every qualifier the label names must hold; one unknown makes it unknown. */
export function labelMatches(label: string, facts: MaterialFacts): Match {
  const q = qualifiersOf(label);
  let unknown = false;
  const check = (want: string | null, have: string | null): boolean => {
    if (want === null) return true;
    if (have === null) { unknown = true; return true; }
    return want === have;
  };
  const ok = check(q.phase, facts.phase) && check(q.pg, facts.pg) && check(q.zone, facts.zone === "none" ? "none" : facts.zone);
  if (!ok) return "no";
  return unknown ? "unknown" : "yes";
}
