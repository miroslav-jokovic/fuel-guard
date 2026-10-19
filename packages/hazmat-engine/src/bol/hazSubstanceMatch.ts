/**
 * Which Appendix A (§172.101) hazardous substances an HMT entry IS — one definition for the paper audit's
 * RQ rule, its marine-pollutant exception and `validateBol`'s required-description line.
 *
 * All three matched the entry's printed names to Appendix A's names EXACTLY. The HMT names a substance
 * with a form after it and Appendix A names it bare, so beside the 155 exact matches it missed the
 * substance itself on 52 entries and its solutions on 37 more (dataset 2026.07.1): "Sodium hydroxide solution" against
 * "Sodium hydroxide", "Ammonia, anhydrous" (RQ 100 lb) against "Ammonia", "Acrolein, stabilized" (RQ 1 lb)
 * against "Acrolein". Each answered `not_listed` — a PASS for a line that may owe "RQ". Found on the
 * owner's 2026-10-19 Mayo Products BOL 14182: eight 3,600 lb totes of 50 % caustic soda, ≈1,800 lb of
 * sodium hydroxide per tote against a 1,000 lb RQ, and the audit said nothing was listed.
 *
 * The form decides how the RQ is judged:
 *   · NEAT — the entry is the substance in a physical state or with a stabiliser (anhydrous, solid,
 *     molten, stabilized …): judged like an exact match, so a package over the RQ owes "RQ".
 *   · MIXTURE — a solution or wetted / fuming / mixed form: the substance is a component of unknown
 *     concentration, so a package can be CLEARED (under the RQ by its whole mass) but never failed.
 * Any other remainder ("Chlorine pentafluoride", "Ethylene glycol monoethyl ether acetate") is a
 * different compound and matches nothing — the word list is closed on purpose, so a new wording falls
 * to "not listed" only after someone has read it. The census is pinned by "pins how many entries each
 * form reaches" (hazmat-golden).
 */
import { norm } from "./paperSupport.js";

export type Substance = { name?: string; nameNormalized: string; rqPounds?: number; rqKg?: number };

/** Forms that leave the entry the substance itself. */
const NEAT_FORMS = new Set([
  "anhydrous", "stabilized", "solid", "liquid", "molten", "compressed", "glacial", "adsorbed",
  "refrigerated liquid", "monomer, stabilized", "inhibited", "dry",
]);
/** Forms that make the substance one component of a mixture. */
const MIXTURE_FORMS = new Set([
  "solution", "solutions", "aqueous solution", "aqueous solutions", "wetted", "fuming", "mixtures",
  "and carbon dioxide mixtures", "solution, stabilized", "solutions, stabilized",
]);

export interface SubstanceMatch {
  neat: Substance[];
  mixture: Substance[];
}

/** The remainder of `name` after `substance`, when the name opens with it as whole words; else null. */
function formAfter(name: string, substance: string): string | null {
  if (!name.startsWith(substance) || name.length === substance.length) return name === substance ? "" : null;
  const next = name[substance.length];
  if (next !== " " && next !== ",") return null;
  return name.slice(substance.length).replace(/^[\s,]+/, "").trim();
}

export function matchHazSubstances(names: readonly string[], table: readonly Substance[]): SubstanceMatch {
  const normalized = names.map(norm);
  const neat: Substance[] = [];
  const mixture: Substance[] = [];
  for (const h of table) {
    const forms = normalized.map((n) => formAfter(n, h.nameNormalized)).filter((f): f is string => f != null);
    if (forms.some((f) => f === "" || NEAT_FORMS.has(f))) neat.push(h);
    else if (forms.some((f) => MIXTURE_FORMS.has(f))) mixture.push(h);
  }
  return { neat, mixture };
}
