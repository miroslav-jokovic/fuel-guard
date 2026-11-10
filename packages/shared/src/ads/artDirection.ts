import { AD_VISUAL_CHECKS, type AdBrandKit, type AdAssetRef, type AdOverlayLayout, type AdPresetRecipe, type AdVisualCheck } from "./brandKitContract.js";
import { publishedFormats, type AdFormat } from "./renderGeometry.js";

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
 *
 * ── COMPOSITION IS DIRECTED (AG3, 2026-11-10; audit F-AG2; D-AD28) ─────────────────────────────────
 * Until AG3 nothing told the image model where the subject goes, how near the camera stands or which part
 * of the frame the words will cover: the only composition instruction anywhere was a clause added AFTER a
 * check had already failed. Now every prompt carries four fixed clauses of ours, between the template and
 * `NO_LETTERING`:
 *   · what the one subject is and how near it is seen — the Art director's two answers, each from a closed
 *     list (`AD_FOCAL_SUBJECTS`, `AD_CAMERA_DISTANCES`) and written here as OUR phrase for that word, so
 *     no model text about composition reaches the image model;
 *   · which part of the frame stays plain — NOT asked of the model: the preset's `layout` already says
 *     where the overlay puts the words, and an answer could only agree with it or be wrong (`QUIET_REGION`);
 *   · the frame's shape — the first format the publisher sends (`publishedFormats`), in words, not digits.
 * A subject the scene does not show (a person when the preset shows none) is refused like any other finding.
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

/** What the picture is OF. Closed: each word becomes a fixed phrase of ours in the prompt (`FOCAL_CLAUSE`). */
export const AD_FOCAL_SUBJECTS = ["tractor", "tractor_and_trailer", "trailer", "person_at_work", "road_ahead", "cab_interior", "setting"] as const;
export type AdFocalSubject = (typeof AD_FOCAL_SUBJECTS)[number];
/** How near the camera stands. */
export const AD_CAMERA_DISTANCES = ["wide", "medium", "close"] as const;
export type AdCameraDistance = (typeof AD_CAMERA_DISTANCES)[number];

const EQUIPMENT_SUBJECTS: ReadonlySet<AdFocalSubject> = new Set(["tractor", "tractor_and_trailer", "trailer"]);

export const FOCAL_CLAUSE: Record<AdFocalSubject, string> = {
  tractor: "the tractor is the one clear subject",
  tractor_and_trailer: "the tractor and its trailer, seen whole, are the one clear subject",
  trailer: "the trailer is the one clear subject",
  person_at_work: "one person at work is the one clear subject",
  road_ahead: "the road ahead is the subject and leads the eye into the frame",
  cab_interior: "the inside of the cab is the subject",
  setting: "the place itself is the subject, with nothing dominating it",
};
export const DISTANCE_CLAUSE: Record<AdCameraDistance, string> = {
  wide: "seen from far off, small within a wide scene",
  medium: "seen from a middle distance, filling about half the frame",
  close: "seen from near, large in the frame and not cut off by its edges",
};
/**
 * Where the overlay puts the words for each layout, so where the picture must stay plain (D-AD28). `where` is
 * what the Art director is TOLD (so its slots do not put a bridge or a treeline there); `clause` is what the
 * image model is told. Derived from the layout, never answered by a model.
 */
export const QUIET_REGION: Record<AdOverlayLayout, { where: string; clause: string }> = {
  bottom_plate: { where: "the lower third of the frame", clause: "the subject kept in the upper two thirds, the lower third plain and uncluttered" },
  top_band: { where: "the upper third of the frame", clause: "the subject kept in the lower two thirds, the upper third plain and uncluttered" },
  centered: { where: "the middle band of the frame", clause: "nothing important across the middle of the frame, which stays plain and uncluttered" },
};
/** The frame's shape in words: a digit in an image prompt is an invitation to draw one. */
export const FRAME_CLAUSE: Record<AdFormat, string> = {
  "4:5": "composed for an upright frame a little taller than it is wide",
  "1:1": "composed for a square frame",
  "9:16": "composed for a tall, narrow upright frame",
};

export interface ArtAnswer {
  slots: Record<string, string>;
  /** sha256 of the kit photo the image starts from, or null for a text-only scene. */
  reference_photo: string | null;
  focal_subject: AdFocalSubject;
  camera_distance: AdCameraDistance;
}

export type ArtFindingKind =
  | "missing_slot" | "unknown_slot" | "slot_too_long" | "digit_in_slot" | "quote_in_slot" | "lettering_in_slot"
  | "reference_required" | "reference_not_in_kit" | "reference_on_text_only" | "focal_subject_not_in_scene";

export interface ArtFinding { kind: ArtFindingKind; slot?: string; text?: string }

/** Words that ask an image model to draw letters. Whole words, case-insensitive, English (the prompt's language). */
const LETTERING = /\b(?:text|texts|logo|logos|lettering|letters?|words?|writing|written|caption|captions|sign|signs|signage|banner|banners|billboards?|posters?|placards?|label|labels|slogan|brand(?:ed|ing)?|decals?|numbers?|digits?|typography|font)\b/i;

export function judgeArt(answer: ArtAnswer, recipe: Pick<AdPresetRecipe, "image_slots" | "starts_from" | "shows_equipment" | "shows_people">, kit: Pick<AdBrandKit, "equipment_photos">): ArtFinding[] {
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
  // The subject must be something the preset's scene shows: a person where no people appear would be asked of
  // the image model by our own clause, past the people policy the precheck already applied.
  if ((answer.focal_subject === "person_at_work" && !recipe.shows_people) || (EQUIPMENT_SUBJECTS.has(answer.focal_subject) && !recipe.shows_equipment)) {
    out.push({ kind: "focal_subject_not_in_scene", text: answer.focal_subject });
  }
  return out;
}

/** How the picture is composed: the Art director's two answers, and the two facts the preset already holds. */
export interface ArtComposition {
  focal_subject: AdFocalSubject;
  camera_distance: AdCameraDistance;
  layout: AdOverlayLayout;
  /** The format the image is made for — the first the publisher sends; null when the preset holds none. */
  frame: AdFormat | null;
}

/** The composition as the image model reads it: our fixed clauses, in a fixed order. */
export function compositionClauses(c: ArtComposition): string[] {
  return [FOCAL_CLAUSE[c.focal_subject], DISTANCE_CLAUSE[c.camera_distance], QUIET_REGION[c.layout].clause, ...(c.frame ? [FRAME_CLAUSE[c.frame]] : [])];
}

/**
 * The recipe's template with its slots filled, then the composition clauses when a composition is given, ending
 * with `NO_LETTERING` exactly once.
 */
export function composeImagePrompt(template: string, slots: Record<string, string>, composition?: ArtComposition): string {
  const filled = template.replace(/\{([a-z][a-z0-9_]{1,30})\}/g, (_m, name: string) => slots[name] ?? `{${name}}`);
  const body = filled.replace(/[\s,.;]*no text,?\s*no logos,?\s*(?:and\s+)?no lettering[\s.]*$/i, "").replace(/[\s,.;]+$/, "");
  return [body, ...(composition ? compositionClauses(composition) : []), NO_LETTERING].join(", ");
}

export interface ArtDirection {
  prompt: string;
  /** The kit photo the generation starts from (C3 uploads it to Higgsfield), or null. */
  reference: AdAssetRef | null;
  slots: Record<string, string>;
  /** What the prompt's composition clauses were written from (AG4 anchors the square cut on it). */
  composition: ArtComposition;
}

/** A judged answer → what the Higgsfield client is handed. Call only when `judgeArt` found nothing. */
export function artDirection(answer: ArtAnswer, recipe: Pick<AdPresetRecipe, "image_prompt_template" | "layout" | "formats">, kit: Pick<AdBrandKit, "equipment_photos">): ArtDirection {
  const reference = answer.reference_photo === null ? null : kit.equipment_photos.find((p) => p.asset.sha256 === answer.reference_photo)!.asset;
  const composition: ArtComposition = { focal_subject: answer.focal_subject, camera_distance: answer.camera_distance, layout: recipe.layout, frame: publishedFormats(recipe.formats)[0] ?? null };
  return { prompt: composeImagePrompt(recipe.image_prompt_template, answer.slots, composition), reference, slots: answer.slots, composition };
}

/**
 * What a regeneration adds to the image prompt for each visual check that failed (D-AD12: "regenerates
 * once with the failure added to the prompt"). Fixed phrases, ours, never the checker's reason: the reason
 * is model text, and nothing a model wrote may reach the image model unchecked (a reason quoting the
 * lettering it saw would ASK for that lettering). `people_policy_met` only fails where people are not
 * allowed, so its clause can say so.
 */
export const REGENERATION_CLAUSES: Record<AdVisualCheck, string> = {
  no_glyphs: "absolutely no writing, letters, numbers or signs anywhere in the image",
  no_foreign_logos: "plain unbranded surfaces with no emblems or company marks",
  equipment_matches_reference: "the same type of truck as the reference photo, unchanged",
  no_malformed_people_or_vehicles: "physically correct vehicles with the right number of wheels and axles",
  people_policy_met: "no people anywhere, including inside the cab",
  // Format-neutral on purpose: the band sits low in 1:1 and 4:5 but mid-frame in 9:16, and one render
  // serves every format the preset has.
  safe_zone_clear: "the subject smaller in the frame, with wide empty road, ground or sky around it",
};

/** The prompt with the clauses for `failed` inserted before `NO_LETTERING`, which it still ends with. */
export function withRegenerationClauses(prompt: string, failed: readonly AdVisualCheck[]): string {
  const clauses = AD_VISUAL_CHECKS.filter((c) => failed.includes(c)).map((c) => REGENERATION_CLAUSES[c]);
  if (clauses.length === 0) return prompt;
  const body = prompt.endsWith(`, ${NO_LETTERING}`) ? prompt.slice(0, -(NO_LETTERING.length + 2)) : prompt;
  return `${body}, ${clauses.join(", ")}, ${NO_LETTERING}`;
}

