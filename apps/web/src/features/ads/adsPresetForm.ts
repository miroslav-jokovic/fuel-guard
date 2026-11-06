import { AD_FORMATS, adPresetSaveSchema, templateSlots, type AdFormat, type AdPresetRecipe, type AdPresetSave } from "@silvicom/shared";

/**
 * The preset editor's form (E2; plan D-AD11), kept apart from the screen so what a save sends can be tested.
 * `adPresetSaveSchema` judges it, here as at the API, so its own sentence is what a person reads.
 *
 * ── BOTH SLOT SETS ARE REQUIRED BY THE SAVE CONTRACT, NOT HERE ────────────────────────────────────
 * `overlay_slots` and `platform_slots` may be null in a stored recipe so older bodies still parse, but compose
 * refuses a preset without the first (`no_overlay_slots`) and the publisher one without the second
 * (`no_platform_slots`). `adPresetSaveSchema` refuses a NEW version without either, at the API and here alike;
 * this form only sends null for a half-chosen pair and shows the contract's sentence.
 *
 * ── `image_slots` IS READ FROM THE TEMPLATE ───────────────────────────────────────────────────────
 * The contract requires them to be exactly the template's `{slots}`, so asking a person to list them again would
 * only offer a way to disagree. `motion_template` is C6's: it has no field yet and is carried through a save.
 */
export interface PresetForm {
  key: string;
  enabled: boolean;
  name: string;
  hook_formula: string;
  copy_slots: Array<{ name: string; max_chars: number | null }>;
  image_prompt_template: string;
  starts_from: AdPresetRecipe["starts_from"];
  shows_equipment: boolean;
  shows_people: boolean;
  motion_template: string | null;
  formats: AdFormat[];
  overlay_headline: string | null;
  overlay_cta: string | null;
  platform_primary_text: string | null;
  platform_headline: string | null;
}

export function blankPresetForm(): PresetForm {
  return {
    key: "", enabled: true, name: "", hook_formula: "", copy_slots: [{ name: "", max_chars: null }], image_prompt_template: "",
    starts_from: "equipment_photo", shows_equipment: true, shows_people: false, motion_template: null, formats: [...AD_FORMATS],
    overlay_headline: null, overlay_cta: null, platform_primary_text: null, platform_headline: null,
  };
}

/** The form for the next version of a saved preset. */
export function presetFormFrom(key: string, enabled: boolean, r: AdPresetRecipe): PresetForm {
  return {
    key, enabled, name: r.name, hook_formula: r.hook_formula, copy_slots: r.copy_slots.map((c) => ({ ...c })),
    image_prompt_template: r.image_prompt_template, starts_from: r.starts_from, shows_equipment: r.shows_equipment,
    shows_people: r.shows_people, motion_template: r.motion_template, formats: [...r.formats],
    overlay_headline: r.overlay_slots?.headline ?? null, overlay_cta: r.overlay_slots?.cta ?? null,
    platform_primary_text: r.platform_slots?.primary_text ?? null, platform_headline: r.platform_slots?.headline ?? null,
  };
}

export type PresetSaveAsk = { ok: true; save: AdPresetSave } | { ok: false; message: string };

/** What the door is sent, or the sentence that says why not. */
export function presetSaveFrom(f: PresetForm): PresetSaveAsk {
  const parsed = adPresetSaveSchema.safeParse({
    key: f.key, enabled: f.enabled,
    recipe: {
      name: f.name, hook_formula: f.hook_formula, copy_slots: f.copy_slots,
      image_prompt_template: f.image_prompt_template, image_slots: templateSlots(f.image_prompt_template),
      starts_from: f.starts_from, shows_equipment: f.shows_equipment, shows_people: f.shows_people,
      motion_template: f.motion_template, formats: f.formats,
      // Either half unchosen sends no slots at all, so the save contract's own sentence is what a person reads.
      overlay_slots: f.overlay_headline && f.overlay_cta ? { headline: f.overlay_headline, cta: f.overlay_cta } : null,
      platform_slots: f.platform_primary_text && f.platform_headline ? { primary_text: f.platform_primary_text, headline: f.platform_headline } : null,
    },
  });
  return parsed.success ? { ok: true, save: parsed.data } : { ok: false, message: parsed.error.issues[0]!.message };
}
