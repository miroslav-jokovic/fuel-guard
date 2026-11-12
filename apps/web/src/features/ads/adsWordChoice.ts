import type { AdsCopyChoice } from "@silvicom/shared";

/**
 * Choosing an ad's words (ADS-AD-LOOK-PLAN Q-ADL7): what the editor starts from, what it sends, and how the door's
 * refusal is turned into a sentence on the line it names. Pure, so it is tested without a screen.
 */
export type Words = AdsCopyChoice["copy"];
export const WORD_LANGUAGES = ["en", "es"] as const;
export const LANGUAGE_LABEL: Record<(typeof WORD_LANGUAGES)[number], string> = { en: "English", es: "Spanish" };

/** A copy as the editor holds it: every slot of the English, in that order, with the Spanish beside it. */
export function editableWords(copy: Record<string, unknown> | null): Words | null {
  const en = copy?.en as Record<string, string> | undefined, es = copy?.es as Record<string, string> | undefined;
  if (!en || !es) return null;
  return { en: { ...en }, es: { ...es } };
}

/** What is sent: every line trimmed. The door checks the rest (slots, limits, claims, the overlay). */
export function choiceFrom(words: Words, fromCandidate: number | null): AdsCopyChoice {
  const trim = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.trim()]));
  return { from_candidate: fromCandidate, copy: { en: trim(words.en), es: trim(words.es) } };
}

/** A slot's name as a reviewer reads it: `second_line` → "Second line". */
export const slotLabel = (slot: string) => slot.charAt(0).toUpperCase() + slot.slice(1).replaceAll("_", " ");

interface SlotFinding { kind: string; language: string; slot: string; text?: string; max_chars?: number; length?: number }
interface OverlayRefusal { format: string; language: string; findings: Array<{ kind: string; label?: string }> }

const CLAIM: Record<string, string> = {
  money_not_in_brief: "names pay the opening does not offer",
  quantity_not_in_brief: "names a number the opening does not state",
  age_not_in_brief: "names an age the opening does not state",
  term_not_in_brief: "promises something the opening does not offer",
  unrecognised_number: "holds a number with nothing saying what it counts",
  forbidden_wording: "uses wording the ad rules forbid",
  foreign_unit: "uses a unit the ad does not use",
};

/** The door's copy findings as one sentence per line: keyed `${language}.${slot}`. */
export function lineErrors(detail: unknown): Record<string, string> {
  const copy = ((detail as { copy?: unknown } | null)?.copy ?? []) as SlotFinding[];
  const out: Record<string, string> = {};
  for (const f of Array.isArray(copy) ? copy : []) {
    const said = f.kind === "too_long" ? `is ${f.length} characters; this line holds ${f.max_chars}`
      : `${CLAIM[f.kind] ?? "cannot be used"}${f.text ? ` ("${f.text}")` : ""}`;
    const key = `${f.language}.${f.slot}`;
    out[key] = out[key] ? `${out[key]}; it also ${said}` : `This line ${said}.`;
  }
  return out;
}

/** The overlay's refusals, which are about the picture's room and not one line: "4:5 in Spanish: the headline needs a third line". */
export function overlayErrors(detail: unknown): string[] {
  const overlay = ((detail as { overlay?: unknown } | null)?.overlay ?? []) as OverlayRefusal[];
  const why = (k: { kind: string; label?: string }) => {
    const what = k.label === "headline" || k.label === "headline_figure" ? "the headline" : k.label === "subline" || k.label === "kicker" ? "the second line" : "the words";
    return k.kind === "too_long" ? `${what} needs a third line` : k.kind === "overflows" ? `${what} is too wide` : k.kind === "stack_too_tall" ? "the words are too tall for the picture" : `${what} cannot be drawn`;
  };
  return (Array.isArray(overlay) ? overlay : []).map((o) => `${o.format} in ${LANGUAGE_LABEL[o.language as "en" | "es"] ?? o.language}: ${[...new Set(o.findings.map(why))].join(", ")}`);
}
