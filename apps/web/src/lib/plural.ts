/**
 * "1 entry", not "1 entries".
 *
 * ── WHY THIS IS A FUNCTION AND NOT A SECOND PROP ────────────────────────────────────────────────
 * `FilterBar` renders `{count} {countLabel}` and every one of its 41 call sites passes a PLURAL
 * noun, so a count of one has always read "1 entries", "1 shelves", "1 truck stops". The obvious
 * alternative — a second `countLabelOne` prop — puts the burden on the author of the 42nd call site
 * to notice a problem nobody noticed in the first 41. Deriving it means the fix arrives for pages
 * nobody edits.
 *
 * ── AND WHY DERIVING IS NEVERTHELESS NOT SAFE ON ITS OWN ───────────────────────────────────────
 * English singularisation cannot be computed. Every rule below is wrong for some real word:
 * `-ies → -y` turns "movies" into "movy", and a `-ves → -f` rule that fixes "shelves" turns "valves"
 * into "valf". A rule set that is *usually* right is the worst kind here, because the failure is a
 * word rendered wrong on a page nobody is looking at, in a component 41 surfaces share.
 *
 * So the guarantee is not the rules. It is `plural.test.ts`, which **reads every `count-label` in
 * `apps/web/src` out of the source** and asserts each one against a checked-in expected singular.
 * A new call site whose noun the rules get wrong fails the build with that noun named, and the
 * answer is one line in `IRREGULAR` below. The rules cover what has been measured; the test is what
 * keeps that true.
 *
 * ── THE HEAD NOUN IS NOT ALWAYS THE LAST WORD ─────────────────────────────────────────────────
 * Two shipped labels are phrases and they disagree about where the noun is: "truck stops" pluralises
 * its LAST word, "segments loaded" and "fills in sequence" pluralise their FIRST. So the rule is
 * neither — it is the last word that is ITSELF plural, which lands on "stops", "segments" and
 * "fills" respectively. Found by measuring the corpus, not by reasoning about grammar.
 */

/**
 * Nouns the rules below get wrong. Shrink-only in spirit: an entry here is a claim that the general
 * rules cannot derive this word, and `plural.test.ts` fails on one that is no longer needed.
 */
const IRREGULAR: Record<string, string> = {
  // `-ves → -f` cannot be a general rule ("valves" → "valf"), so the one shipped word that needs it
  // is named instead. INVENTORY-PLAN.md I4's Parts page counts these.
  shelves: "shelf",
};

/** Words that end in `s` and are already singular — dropping the `s` would maim them. */
const ALREADY_SINGULAR = /(?:ss|us|is)$/;

/** One word, from plural to singular. Exported for the test; callers want `countPhrase`. */
export function singularWord(word: string): string {
  const lower = word.toLowerCase();
  const irregular = IRREGULAR[lower];
  if (irregular) return irregular;

  if (ALREADY_SINGULAR.test(lower)) return word;
  // "entries" → "entry", but never on a word so short that the stem disappears.
  if (word.length > 4 && lower.endsWith("ies")) return `${word.slice(0, -3)}y`;
  // "boxes" → "box", "matches" → "match": the `es` is the plural marker, not part of the stem.
  if (/(?:ch|sh|x|z|s)es$/.test(lower)) return word.slice(0, -2);
  if (lower.endsWith("s")) return word.slice(0, -1);
  return word;
}

/**
 * The singular of a plural label, phrase or single word.
 *
 * The head noun is the LAST word that is itself plural — see the header for the two shipped phrases
 * that make any simpler rule wrong. A label with no plural word in it is returned unchanged, which
 * is the right answer for a label that was never a count of anything.
 */
export function singularLabel(plural: string): string {
  const words = plural.split(" ");
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const singular = singularWord(words[i]!);
    if (singular !== words[i]) {
      words[i] = singular;
      return words.join(" ");
    }
  }
  return plural;
}

/**
 * The label to render beside `count`.
 *
 * ⚠ Only ONE is singular. Zero takes the plural — "0 results", never "0 result" — which is English
 * and is also what every one of these bars renders today when a filter matches nothing.
 */
export function countLabelFor(count: number, plural: string): string {
  return count === 1 ? singularLabel(plural) : plural;
}
