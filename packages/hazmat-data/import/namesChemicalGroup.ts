/**
 * `namesChemicalGroup` — does an n.o.s./generic HMT entry's own name already name a chemical element or
 * group? (Q-DR17, owner ruling 2026-10-09.) 49 CFR 172.203(k)(2), eCFR text of 2026-10-07: the
 * technical-name requirement of (k) does not apply —
 *   "(iii) If the n.o.s. description for the material (other than a mixture of hazardous materials of
 *    different classes meeting the definitions of more than one hazard class) contains the name of the
 *    chemical element or group which is primarily responsible for the material being included in the
 *    hazard class indicated.
 *    (iv) If the n.o.s. description for the material (which is a mixture of hazardous materials of
 *    different classes meeting the definition of more than one hazard class) contains the name of the
 *    chemical element or group responsible for the material meeting the definition of one of these
 *    classes. In such cases, only the technical name of the component that is not appropriately
 *    identified in the n.o.s. description shall be entered in parentheses."
 *
 * The HMT prints no such column, so the flag is DERIVED here, from the entry's own text, by one rule:
 *
 *   A name's HEAD is its text before the first comma ("Arsenic compounds, liquid, n.o.s." → "Arsenic
 *   compounds"), with "n.o.s." and parenthesised asides removed. The name names a chemical group when
 *   its head holds at least one word that is NOT in `NOT_A_CHEMICAL` below. The entry is flagged when
 *   ANY of its legal names (printed + 'or' alternates) does — a shipper may use any of them.
 *
 * `NOT_A_CHEMICAL` is the vocabulary the rule stands on, in three closed groups, each word read off the
 * heads of the current HMT's G and n.o.s. entries (2026-07-28 capture): the hazard words of the class
 * and division names (§173.2 and the definitions it points to — "Flammable liquids", "Toxic solid",
 * "Organic peroxide type B"), the words for physical form and packaging ("liquid", "gas", "articles",
 * "compounds", "mixture"), and the words for a USE or ORIGIN rather than a chemistry ("pesticide",
 * "medicine", "dyes", "refrigerant", "toxins"). Everything else in a head — "arsenic", "alcohols",
 * "isocyanates", "organometallic", "petroleum" — is a chemical word by elimination. The vocabulary is
 * pinned row-by-row in namesChemicalGroup.test.ts; a new HMT head word lands on the chemical side until
 * a person moves it, so the change shows up as a flag diff in the next cut, not silently.
 *
 * What the flag does NOT say: that the named group is the one "primarily responsible" for the class
 * ((iii)), or which class it explains in a multi-class mixture ((iv)). Those depend on the material, not
 * the name. So the flag can make a missing technical name a definite FAIL (false: the name names no
 * chemical, so (iii)/(iv) cannot apply) but never a definite pass (true: they may apply).
 *
 * Scope: entries with the "G" symbol or "n.o.s" in a name; every other entry is left without the field.
 */

import type { HmtEntry } from "../src/schema.js";

const HAZARD = [
  "flammable", "non-flammable", "combustible", "corrosive", "toxic", "oxidizing",
  "infectious", "self-heating", "self-reactive", "water-reactive", "pyrophoric", "explosive",
  "polymerizing", "desensitized", "environmentally", "hazardous", "dangerous", "regulated", "inhalation", "caustic",
  "elevated", "temperature", "aviation", "organic", "peroxide",
  // the Division 4.2 / 4.3 / Class 9 wording an "Articles containing …" head repeats
  "liable", "spontaneous", "combustion", "which", "contact", "water", "emits", "miscellaneous", "goods",
];
const FORM = [
  "liquid", "liquids", "solid", "solids", "gas", "gases", "substance", "substances", "articles",
  "mixture", "mixtures", "solution", "solutions", "preparations", "compound", "compounds",
  "compressed", "liquefied", "adsorbed", "chemical", "under", "pressure", "containing", "other", "type",
  "by", "in", "of", "to", "with", "sample", "samples", "waste", "aerosols", "powder", "powders",
  "a", "b", "c", "d", "e", "f",
];
const USE_OR_ORIGIN = [
  "pesticides", "insecticide", "disinfectant", "disinfectants", "dye", "dyes", "intermediates",
  "medicine", "refrigerant", "dispersant", "tear", "toxins", "components", "contrivances", "ammunition", "medical",
  "clinical", "biomedical", "fibers", "fabrics", "batteries", "plastics", "vegetable", "synthetic",
];
export const NOT_A_CHEMICAL: ReadonlySet<string> = new Set([...HAZARD, ...FORM, ...USE_OR_ORIGIN]);

/** The head words of one legal name: text before the first comma, "n.o.s." and "(…)" asides removed. */
export function headWords(name: string): string[] {
  const head = (name.split(",")[0] ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bn\.o\.s\.?/gi, " ")
    .toLowerCase();
  return head.split(/[\s/]+/).map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")).filter(Boolean);
}

/** One name: does its head hold a word outside the not-a-chemical vocabulary? */
export function nameNamesChemicalGroup(name: string): boolean {
  return headWords(name).some((w) => !NOT_A_CHEMICAL.has(w));
}

/** Whether the rule applies to an entry at all: a "G" entry, or one with "n.o.s" in a legal name. */
export function inGroupFlagScope(entry: Pick<HmtEntry, "symbols" | "psnPrinted" | "psnAlternates">): boolean {
  return entry.symbols.includes("G") || [entry.psnPrinted, ...entry.psnAlternates].some((n) => /n\.o\.s/i.test(n));
}

/** The flag for one entry, or undefined when the entry is out of scope. */
export function deriveNamesChemicalGroup(entry: Pick<HmtEntry, "symbols" | "psnPrinted" | "psnAlternates">): boolean | undefined {
  if (!inGroupFlagScope(entry)) return undefined;
  return [entry.psnPrinted, ...entry.psnAlternates].some(nameNamesChemicalGroup);
}

/** Return entries with the flag set where in scope (others unchanged — no key added). */
export function withNamesChemicalGroup(entries: HmtEntry[]): HmtEntry[] {
  return entries.map((e) => {
    const flag = deriveNamesChemicalGroup(e);
    return flag === undefined ? e : { ...e, namesChemicalGroup: flag };
  });
}

type FlagInput = Pick<HmtEntry, "symbols" | "psnPrinted" | "psnAlternates">;

/** The two-source check of the derivation: one field diff when two parses of the same row disagree. */
export function groupFlagDiffs(a: FlagInput, b: FlagInput): Array<{ field: string; sourceA: unknown; sourceB: unknown }> {
  const fa = deriveNamesChemicalGroup(a);
  const fb = deriveNamesChemicalGroup(b);
  return fa === fb ? [] : [{ field: "namesChemicalGroup", sourceA: fa ?? null, sourceB: fb ?? null }];
}
