/**
 * Which Appendix A (hazardous substances) or Appendix B (marine pollutants) rows an HMT entry IS — one
 * definition for every reader of either list: the paper audit's RQ rule and marine-pollutant exception,
 * `validateBol`'s required-description lines, and `classifyMarinePollutantEntry` (the placard engine's
 * §172.322 mark and the products API's concentration question).
 *
 * All of them matched the entry's printed names to the appendix names EXACTLY. The HMT names a material
 * with a form after it and the appendices name it bare, so the match missed:
 *   · Appendix A — beside 155 exact matches, the substance itself on 52 entries and its solutions on 37
 *     (dataset 2026.07.1): "Sodium hydroxide solution" (the owner's 2026-10-19 Mayo Products BOL 14182,
 *     ≈1,800 lb NaOH per tote against a 1,000 lb RQ), "Ammonia, anhydrous" (RQ 100 lb), "Acrolein,
 *     stabilized" (RQ 1 lb). Each answered `not_listed` — a PASS for a line that may owe "RQ".
 *   · Appendix B — beside 132 exact matches, 7 neat and 6 mixture entries more, among them UN2315
 *     "Polychlorinated biphenyls, liquid", a SEVERE marine pollutant no rule recognised at all.
 *
 * The form decides how the row is held:
 *   · NEAT — the material in a physical state or with a stabiliser (anhydrous, solid, liquid, molten,
 *     stabilized …): it IS the listed material, judged like an exact match.
 *   · MIXTURE — a solution, a wetted / fuming form, "… mixtures", "and <other> mixture": the listed
 *     material is a component of unknown concentration. Appendix A can only CLEAR such a package (under
 *     the RQ by its whole mass), never fail it; Appendix B treats it as listed, because §171.8's
 *     concentration test then decides and an unknown concentration takes the stricter figure.
 * Any other remainder ("Chlorine pentafluoride", "Turpentine substitute", "Aniline hydrochloride") is a
 * different compound and matches nothing. The word lists are closed on purpose, so a new wording falls to
 * "not listed" only after someone has read it — the census is pinned by "pins how many entries each
 * form reaches" (hazmat-golden).
 */

/** Same fold as every appendix `nameNormalized` (import side): lower case, single spaces. */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Forms that leave the entry the listed material itself. */
const NEAT_FORMS = new Set([
  "anhydrous", "stabilized", "solid", "liquid", "molten", "compressed", "glacial", "adsorbed",
  "refrigerated liquid", "monomer, stabilized", "inhibited", "dry",
]);
/** Forms that make the listed material one component of a mixture. */
const MIXTURE_FORMS = new Set([
  "solution", "solutions", "aqueous solution", "aqueous solutions", "wetted", "fuming",
  "mixture", "mixtures", "mixtures, n.o.s", "mixtures, n.o.s.", "n.o.s", "n.o.s.",
  "solution, stabilized", "solutions, stabilized",
]);
/** "… and methyl bromide mixtures", "… and carbon dioxide mixture" — the listed material plus another. */
const AND_MIXTURE = /^and .+ mixtures?$/;

export type Substance = { name?: string; nameNormalized: string; rqPounds?: number; rqKg?: number };

export interface AppendixMatch<T> {
  neat: T[];
  mixture: T[];
}

/** The remainder of `name` after `listed`, when the name opens with it as whole words; "" when equal; else null. */
function formAfter(name: string, listed: string): string | null {
  if (name === listed) return "";
  if (!name.startsWith(listed)) return null;
  const next = name[listed.length];
  if (next !== " " && next !== ",") return null;
  return name.slice(listed.length).replace(/^[\s,]+/, "").trim();
}

export function matchAppendixNames<T extends { nameNormalized: string }>(
  names: readonly string[],
  table: readonly T[],
): AppendixMatch<T> {
  const normalized = names.map(norm);
  const neat: T[] = [];
  const mixture: T[] = [];
  for (const row of table) {
    const forms = normalized.map((n) => formAfter(n, row.nameNormalized)).filter((f): f is string => f != null);
    if (forms.some((f) => f === "" || NEAT_FORMS.has(f))) neat.push(row);
    else if (forms.some((f) => MIXTURE_FORMS.has(f) || AND_MIXTURE.test(f))) mixture.push(row);
  }
  return { neat, mixture };
}
