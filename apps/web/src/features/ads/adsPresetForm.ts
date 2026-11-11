import {
  AD_FORMATS, AD_HOOK_FAMILIES, AD_HOOK_FAMILY_LABELS, AD_LOOKS, AD_OVERLAY_LAYOUTS, AD_SCENE_FAMILIES, AD_SCENE_FAMILY_LABELS, adPresetSaveSchema, templateSlots,
  type AdFormat, type AdHookFamily, type AdLook, type AdOverlayLayout, type AdPresetRecipe, type AdPresetSave, type AdSceneFamily,
} from "@silvicom/shared";

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
  /** Where the words sit on the picture (CQ6). */
  layout: AdOverlayLayout;
  /** How the words are drawn (ADS-AD-LOOK-PLAN D-ADL11). A recipe saved before the looks shows as `rail`, which is what it draws. */
  look: AdLook;
  /** The concept (Q-AD58). Null until chosen — and for a version of a preset saved before the families existed. */
  hook_family: AdHookFamily | null;
  scene_family: AdSceneFamily | null;
  formats: AdFormat[];
  overlay_headline: string | null;
  overlay_cta: string | null;
  /** The two small lines (D-ADL4). Null = that line is not drawn; neither is required. */
  overlay_kicker: string | null;
  overlay_subline: string | null;
  platform_primary_text: string | null;
  platform_headline: string | null;
}

export function blankPresetForm(): PresetForm {
  return {
    key: "", enabled: true, name: "", hook_formula: "", copy_slots: [{ name: "", max_chars: null }], image_prompt_template: "",
    starts_from: "equipment_photo", shows_equipment: true, shows_people: false, motion_template: null, layout: "bottom_plate", look: "rail", formats: [...AD_FORMATS],
    hook_family: null, scene_family: null,
    overlay_headline: null, overlay_cta: null, overlay_kicker: null, overlay_subline: null, platform_primary_text: null, platform_headline: null,
  };
}

/** The form for the next version of a saved preset. */
export function presetFormFrom(key: string, enabled: boolean, r: AdPresetRecipe): PresetForm {
  return {
    key, enabled, name: r.name, hook_formula: r.hook_formula, copy_slots: r.copy_slots.map((c) => ({ ...c })),
    image_prompt_template: r.image_prompt_template, starts_from: r.starts_from, shows_equipment: r.shows_equipment,
    shows_people: r.shows_people, motion_template: r.motion_template, layout: r.layout, look: r.look ?? "rail", formats: [...r.formats],
    hook_family: r.hook_family ?? null, scene_family: r.scene_family ?? null,
    overlay_headline: r.overlay_slots?.headline ?? null, overlay_cta: r.overlay_slots?.cta ?? null,
    overlay_kicker: r.overlay_slots?.kicker ?? null, overlay_subline: r.overlay_slots?.subline ?? null,
    platform_primary_text: r.platform_slots?.primary_text ?? null, platform_headline: r.platform_slots?.headline ?? null,
  };
}

/**
 * How each layout reads in the drawer; the list itself is the contract's (`AD_OVERLAY_LAYOUTS`). The stored names
 * predate the looks — nothing is drawn on a plate or a band any more (D-ADL8) — so a person reads where the words
 * sit, which is all a layout now says.
 */
export const LAYOUT_LABEL: Record<AdOverlayLayout, string> = {
  bottom_plate: "Low: words at the bottom of the picture",
  top_band: "High: words at the top of the picture",
  centered: "Middle: words across the centre",
};
export const layoutOptions = () => AD_OVERLAY_LAYOUTS.map((l) => ({ value: l, label: LAYOUT_LABEL[l] }));

/** How each look reads in the drawer; the list is the contract's (`AD_LOOKS`). */
export const LOOK_LABEL: Record<AdLook, string> = {
  rail: "Rail: left-aligned, figures in the accent colour, footer in the brand colour",
  ribbon: "Ribbon: centred, second line on an accent ribbon, round button",
};
export const lookOptions = () => AD_LOOKS.map((l) => ({ value: l, label: LOOK_LABEL[l] }));

/** The concept families, worded as the contract words them; the lists are the contract's (Q-AD58), never restated. */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const hookFamilyOptions = () => AD_HOOK_FAMILIES.map((h) => ({ value: h, label: sentence(AD_HOOK_FAMILY_LABELS[h]) }));
export const sceneFamilyOptions = () => AD_SCENE_FAMILIES.map((s) => ({ value: s, label: sentence(AD_SCENE_FAMILY_LABELS[s]) }));

export type PresetSaveAsk = { ok: true; save: AdPresetSave } | { ok: false; message: string };

/** What the door is sent, or the sentence that says why not. */
export function presetSaveFrom(f: PresetForm): PresetSaveAsk {
  const parsed = adPresetSaveSchema.safeParse({
    key: f.key, enabled: f.enabled,
    recipe: {
      name: f.name, hook_formula: f.hook_formula, copy_slots: f.copy_slots,
      image_prompt_template: f.image_prompt_template, image_slots: templateSlots(f.image_prompt_template),
      starts_from: f.starts_from, shows_equipment: f.shows_equipment, shows_people: f.shows_people,
      motion_template: f.motion_template, layout: f.layout, look: f.look, formats: f.formats,
      hook_family: f.hook_family ?? undefined, scene_family: f.scene_family ?? undefined,
      // Either half unchosen sends no slots at all, so the save contract's own sentence is what a person reads.
      // A small line left as "Not drawn" sends no key, as a preset saved before the looks has none.
      overlay_slots: f.overlay_headline && f.overlay_cta
        ? { headline: f.overlay_headline, cta: f.overlay_cta, ...(f.overlay_kicker ? { kicker: f.overlay_kicker } : {}), ...(f.overlay_subline ? { subline: f.overlay_subline } : {}) }
        : null,
      platform_slots: f.platform_primary_text && f.platform_headline ? { primary_text: f.platform_primary_text, headline: f.platform_headline } : null,
    },
  });
  return parsed.success ? { ok: true, save: parsed.data } : { ok: false, message: parsed.error.issues[0]!.message };
}
