import type { AdBrandKit, AdAssetRef, AdPresetRecipe } from "./brandKitContract.js";

/**
 * The Art director's rules, pure (ADS-AGENT-PLAN D-AD9, D-AD11; workflow §4R's Art director row: "every
 * prompt ends with the no-lettering clause and uses a reference photo when the preset shows equipment —
 * pure check, absolute"). The model fills a preset's image slots; this file decides whether it may be
 * asked, and whether what it answered becomes an image prompt. The Higgsfield client (C3) sends only a
 * prompt `composeImagePrompt` made; the Checker (C5) reads the same clause.
 *
 * ── BEFORE THE MODEL: TWO RECIPES THAT CANNOT BE HONOURED ──────────────────────────────────────────
 * A preset that shows equipment starts from a real photo of OUR equipment (D-AD9, proven practice 3);
 * with no photo in the kit it would show a stranger's truck, so it is refused, not improvised. A preset
 * that shows people under a kit whose people policy is `none` (Q-AD13's fallback) is refused too.
 * Neither costs a call.
 *
 * ── AFTER THE MODEL: NOTHING THAT BECOMES LETTERS ──────────────────────────────────────────────────
 * The image model never writes text or numbers (D-AD9): the overlay renderer composites every figure.
 * So a slot value may hold no digit, no quotation (a quote is words for the image to spell), and no word
 * that asks for lettering (a sign, a logo, a caption); and the prompt always ENDS with `NO_LETTERING`,
 * whatever the recipe's template already says. The reference photo the model names must be one of this
 * kit's — and none at all for a text-only scene.
 */

export const NO_LETTERING = "no text, no logos, no lettering";
/** The longest a slot value may be: a phrase that names a thing, not a paragraph that directs a scene. */
export const ART_SLOT_MAX_CHARS = 120;

export type ArtRefusal = "no_reference_photo" | "people_policy_none";

/** Whether this recipe can be art-directed under this kit at all. Null = ask the model. */
export function artPrecheck(recipe: Pick<AdPresetRecipe, "shows_equipment" | "shows_people" | "starts_from">, kit: Pick<AdBrandKit, "equipment_photos" | "people_policy">): ArtRefusal | null {
  if ((recipe.shows_equipment || recipe.starts_from === "equipment_photo") && kit.equipment_photos.length === 0) return "no_reference_photo";
  if (recipe.shows_people && kit.people_policy === "none") return "people_policy_none";
  return null;
}

export interface ArtAnswer {
  slots: Record<string, string>;
  /** sha256 of the kit photo the image starts from, or null for a text-only scene. */
  reference_photo: string | null;
}

export type ArtFindingKind =
  | "missing_slot" | "unknown_slot" | "slot_too_long" | "digit_in_slot" | "quote_in_slot" | "lettering_in_slot"
  | "reference_required" | "reference_not_in_kit" | "reference_on_text_only";

export interface ArtFinding { kind: ArtFindingKind; slot?: string; text?: string }

/** Words that ask an image model to draw letters. Whole words, case-insensitive, English (the prompt's language). */
const LETTERING = /\b(?:text|texts|logo|logos|lettering|letters?|words?|writing|written|caption|captions|sign|signs|signage|banner|banners|billboards?|posters?|placards?|label|labels|slogan|brand(?:ed|ing)?|decals?|numbers?|digits?|typography|font)\b/i;

export function judgeArt(answer: ArtAnswer, recipe: Pick<AdPresetRecipe, "image_slots" | "starts_from">, kit: Pick<AdBrandKit, "equipment_photos">): ArtFinding[] {
  const out: ArtFinding[] = [];
  const declared = new Set(recipe.image_slots);
  for (const s of recipe.image_slots) if (!(s in answer.slots)) out.push({ kind: "missing_slot", slot: s });
  for (const [slot, value] of Object.entries(answer.slots)) {
    if (!declared.has(slot)) { out.push({ kind: "unknown_slot", slot }); continue; }
    if (value.length > ART_SLOT_MAX_CHARS) out.push({ kind: "slot_too_long", slot, text: value });
    if (/\d/.test(value)) out.push({ kind: "digit_in_slot", slot, text: value });
    if (/["“”‘’]|(?<![a-z])'|'(?![a-z])/i.test(value)) out.push({ kind: "quote_in_slot", slot, text: value });
    const word = LETTERING.exec(value);
    if (word) out.push({ kind: "lettering_in_slot", slot, text: word[0] });
  }
  const photos = new Set(kit.equipment_photos.map((p) => p.asset.sha256));
  if (recipe.starts_from === "equipment_photo") {
    if (answer.reference_photo === null) out.push({ kind: "reference_required" });
    else if (!photos.has(answer.reference_photo)) out.push({ kind: "reference_not_in_kit", text: answer.reference_photo });
  } else if (answer.reference_photo !== null) out.push({ kind: "reference_on_text_only", text: answer.reference_photo });
  return out;
}

/** The recipe's template with its slots filled, ending with `NO_LETTERING` exactly once. */
export function composeImagePrompt(template: string, slots: Record<string, string>): string {
  const filled = template.replace(/\{([a-z][a-z0-9_]{1,30})\}/g, (_m, name: string) => slots[name] ?? `{${name}}`);
  const body = filled.replace(/[\s,.;]*no text,?\s*no logos,?\s*(?:and\s+)?no lettering[\s.]*$/i, "").replace(/[\s,.;]+$/, "");
  return `${body}, ${NO_LETTERING}`;
}

export interface ArtDirection {
  prompt: string;
  /** The kit photo the generation starts from (C3 uploads it to Higgsfield), or null. */
  reference: AdAssetRef | null;
  slots: Record<string, string>;
}

/** A judged answer → what the Higgsfield client is handed. Call only when `judgeArt` found nothing. */
export function artDirection(answer: ArtAnswer, recipe: Pick<AdPresetRecipe, "image_prompt_template">, kit: Pick<AdBrandKit, "equipment_photos">): ArtDirection {
  const reference = answer.reference_photo === null ? null : kit.equipment_photos.find((p) => p.asset.sha256 === answer.reference_photo)!.asset;
  return { prompt: composeImagePrompt(recipe.image_prompt_template, answer.slots), reference, slots: answer.slots };
}
