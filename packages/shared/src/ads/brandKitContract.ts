import { z } from "zod";
import { recordId } from "../recordId.js";
import { AD_FORMATS, parseHex, safeZone, tightenZone, type AdFormat } from "./renderGeometry.js";

/**
 * The brand kit and the concept presets (ADS-AGENT-PLAN D-AD10, D-AD11; workflow C1). These are the
 * shapes 0537's `ad_brand_kit_versions.kit` and `ad_concept_preset_versions.recipe` hold — the "shared
 * brand-kit contract (A3)" that migration's comment names, which A3 left unwritten.
 *
 * Nothing here carries a value. The company name, the colours, the photos and the five presets are the
 * owner's (Q-AD14, Q-AD12); until they answer, tests use fixtures and production holds no kit at all,
 * which the workers read as "nothing to compose under" — never a default somebody typed in code.
 *
 * ── ASSETS ARE NAMED BY THEIR BYTES ────────────────────────────────────────────────────────────────
 * A logo or photo is referred to by the sha256 of the bytes we stored (`ad-assets/<org>/<sha256>.<ext>`,
 * migration 0562). A version therefore cannot point at a file that changed after it was saved: a new
 * file is a new hash, so a past creative's inputs are exactly reproducible. Only raster formats are
 * stored; an uploaded SVG is rasterised first (`source_format: "svg"` records that it was one).
 */

export const AD_ASSET_FORMATS = ["png", "jpeg", "webp"] as const;
export type AdAssetFormat = (typeof AD_ASSET_FORMATS)[number];

/** What an upload may have been: the stored formats, plus SVG (rasterised to PNG before it is stored). */
export const AD_ASSET_SOURCE_FORMATS = [...AD_ASSET_FORMATS, "svg"] as const;

/** The largest upload taken, before any rasterising — a phone photo at full resolution fits. */
export const AD_ASSET_MAX_BYTES = 15 * 1024 * 1024;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const hex = z.string().refine((s) => parseHex(s) !== null, "a colour is six hex digits, like #0B3D2E");

export const adAssetRefSchema = z.object({
  sha256,
  format: z.enum(AD_ASSET_FORMATS),
  source_format: z.enum(AD_ASSET_SOURCE_FORMATS),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byte_size: z.number().int().positive(),
});
export type AdAssetRef = z.infer<typeof adAssetRefSchema>;

/**
 * The visual check's closed list (D-AD12 §2): the checker answers each one pass/fail with a reason. A
 * kit cannot add a free-text check — an item the checker was never built to answer would be a pass by
 * default — it fills in the two that take data (`people_policy`, `forbidden_marks`).
 */
export const AD_VISUAL_CHECKS = [
  "no_glyphs",
  "no_foreign_logos",
  "equipment_matches_reference",
  "no_malformed_people_or_vehicles",
  "people_policy_met",
  "safe_zone_clear",
] as const;
export type AdVisualCheck = (typeof AD_VISUAL_CHECKS)[number];

/**
 * Who may appear in a generated image. `none` is Q-AD13's fallback; `varied` is D-AD8's rule (Title VII
 * §704(b), ADEA 29 CFR 1625.4) that generated people vary across a set. There is no third value that
 * lets a set show one demographic.
 */
export const AD_PEOPLE_POLICIES = ["none", "varied"] as const;

const rectSchema = z.object({
  x: z.number().int().min(0), y: z.number().int().min(0),
  width: z.number().int().positive(), height: z.number().int().positive(),
});

/** One format's overlay. `zone` null = the default safe zone; a kit may only tighten it (`tightenZone`). */
const overlaySchema = z.object({
  zone: rectSchema.nullable(),
  text_color: hex,
  /** A plate drawn behind the text, or null for text straight on the image (the render check then decides). */
  plate_color: hex.nullable(),
});

/**
 * The overlay a new kit starts with for each format: white text on a dark plate. A format with no overlay is
 * refused at compose (`no_template`), so the editor (E2) fills these in; the render check still measures contrast.
 */
export const AD_OVERLAY_START = { text_color: "#FFFFFF", plate_color: "#111111" } as const;

export const adBrandKitSchema = z.object({
  /** Exactly as it should read in an ad. */
  company_name: z.string().trim().min(1).max(120),
  /** The phone an ad shows, as printed; null = no phone in the overlay. */
  phone: z.string().trim().min(7).max(40).nullable(),
  colors: z.array(z.object({ name: z.string().trim().min(1).max(40), hex })).min(1).max(12),
  /** Null = Q-AD14's fallback: no logo overlay. */
  logo: adAssetRefSchema.nullable(),
  /**
   * The reference photos of our real equipment (D-AD9): a preset that shows equipment starts from one.
   * `label` says what it shows ("white Freightliner, front three-quarter") for the art director's slot.
   */
  equipment_photos: z.array(z.object({ label: z.string().trim().min(2).max(120), asset: adAssetRefSchema })).max(20),
  overlays: z.partialRecord(z.enum(AD_FORMATS), overlaySchema),
  people_policy: z.enum(AD_PEOPLE_POLICIES),
  /** Other companies' names and marks the visual check looks for — a competitor's logo on a trailer fails. */
  forbidden_marks: z.array(z.string().trim().min(2).max(80)).max(40),
}).superRefine((kit, ctx) => {
  for (const [format, overlay] of Object.entries(kit.overlays) as [AdFormat, z.infer<typeof overlaySchema>][]) {
    if (overlay.zone && !tightenZone(safeZone(format), overlay.zone)) {
      ctx.addIssue({ code: "custom", path: ["overlays", format, "zone"], message: `the ${format} text zone must sit inside the default safe zone` });
    }
  }
});
export type AdBrandKit = z.infer<typeof adBrandKitSchema>;

/** Every asset a kit refers to — what a save checks is stored for this org before it writes. */
export function kitAssets(kit: AdBrandKit): AdAssetRef[] {
  return [...(kit.logo ? [kit.logo] : []), ...kit.equipment_photos.map((p) => p.asset)];
}

// ── concept presets (D-AD11) ────────────────────────────────────────────────────────────────────
const slotName = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/, "a slot's name is lower-case letters, digits and underscores, like hook");
const SLOT_IN_TEMPLATE = /\{([a-z][a-z0-9_]{1,30})\}/g;

/** The `{slot}` names a template uses, in order of first appearance. */
export function templateSlots(template: string): string[] {
  return [...new Set([...template.matchAll(SLOT_IN_TEMPLATE)].map((m) => m[1]!))];
}

/**
 * A preset is a fixed recipe, not a free prompt: the model fills `image_slots` and the copy slots and
 * cannot change anything else. The image template therefore names exactly its slots — an undeclared
 * `{x}` would reach the image model unfilled, and a declared slot the template never uses is a slot the
 * art director fills for nothing.
 *
 * `starts_from` is D-AD9: a scene with equipment or a person is image-to-image from a kit photo; a
 * text-only scene is allowed only for roads, skies and empty cabs.
 */
export const adPresetRecipeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  hook_formula: z.string().trim().min(5).max(500),
  /**
   * The copy's slots, in reading order ("hook", "pay", "cta"), each with the most characters it may hold
   * in either language. The limit is the preset's (an overlay line, a Meta headline), so the copywriter's
   * tool schema carries it and an answer that runs over is refused, never trimmed (C2).
   */
  copy_slots: z.array(z.object({ name: slotName, max_chars: z.number().int().min(10).max(500) })).min(1).max(8),
  image_prompt_template: z.string().trim().min(10).max(2000),
  image_slots: z.array(slotName).max(8),
  starts_from: z.enum(["equipment_photo", "text_only"]),
  shows_equipment: z.boolean(),
  shows_people: z.boolean(),
  /** Null = a still-only preset (C6 owns motion). */
  motion_template: z.string().trim().min(10).max(2000).nullable(),
  formats: z.array(z.enum(AD_FORMATS)).min(1).max(AD_FORMATS.length),
  /**
   * Which copy slots the overlay draws (C5b): the headline (≤ 2 lines) and the call to action. The other
   * slots are the platform's text (B2c). Null = not said, and compose refuses the preset by name
   * (`no_overlay_slots`) rather than guess from a slot's name. Nullable with a default so a preset saved
   * before C5b still parses — `newestVersions` throws on a stored body that does not.
   */
  overlay_slots: z.object({ headline: slotName, cta: slotName }).strict().nullable().default(null),
  /**
   * Which copy slots the platform shows as text beside the image (B2c): Meta's primary text (`message`,
   * above the image) and its headline (`name`, under it). Neither may be an overlay slot — those words
   * are already IN the image. Null = not said, and the publisher refuses the creative by name
   * (`no_platform_slots`) rather than guess from the slots' order or names. Absent and null both mean "not
   * said": optional rather than defaulted (as `overlay_slots` is) so a recipe typed before B2c still
   * compiles — a default makes the parsed type require the key in every literal.
   */
  platform_slots: z.object({ primary_text: slotName, headline: slotName }).strict().nullish(),
}).superRefine((r, ctx) => {
  const used = templateSlots(r.image_prompt_template);
  const declared = new Set(r.image_slots);
  for (const s of used) if (!declared.has(s)) ctx.addIssue({ code: "custom", path: ["image_prompt_template"], message: `{${s}} is not one of image_slots` });
  for (const s of declared) if (!used.includes(s)) ctx.addIssue({ code: "custom", path: ["image_slots"], message: `${s} is never used in the template` });
  if (new Set(r.image_slots).size !== r.image_slots.length) ctx.addIssue({ code: "custom", path: ["image_slots"], message: "a slot is listed twice" });
  if (new Set(r.copy_slots.map((c) => c.name)).size !== r.copy_slots.length) ctx.addIssue({ code: "custom", path: ["copy_slots"], message: "a slot is listed twice" });
  const copyNames = new Set(r.copy_slots.map((c) => c.name));
  if (r.overlay_slots) {
    for (const role of ["headline", "cta"] as const) {
      if (!copyNames.has(r.overlay_slots[role])) ctx.addIssue({ code: "custom", path: ["overlay_slots", role], message: `${r.overlay_slots[role]} is not one of copy_slots` });
    }
    if (r.overlay_slots.headline === r.overlay_slots.cta) ctx.addIssue({ code: "custom", path: ["overlay_slots"], message: "the headline and the call to action are different slots" });
  }
  if (r.platform_slots) {
    const overlay = new Set(r.overlay_slots ? [r.overlay_slots.headline, r.overlay_slots.cta] : []);
    for (const role of ["primary_text", "headline"] as const) {
      const slot = r.platform_slots[role];
      if (!copyNames.has(slot)) ctx.addIssue({ code: "custom", path: ["platform_slots", role], message: `${slot} is not one of copy_slots` });
      else if (overlay.has(slot)) ctx.addIssue({ code: "custom", path: ["platform_slots", role], message: `${slot} is drawn on the image; the platform's text is another slot` });
    }
    if (r.platform_slots.primary_text === r.platform_slots.headline) ctx.addIssue({ code: "custom", path: ["platform_slots"], message: "the primary text and the headline are different slots" });
  }
  if (new Set(r.formats).size !== r.formats.length) ctx.addIssue({ code: "custom", path: ["formats"], message: "a format is listed twice" });
  if (r.starts_from === "text_only" && (r.shows_equipment || r.shows_people)) {
    ctx.addIssue({ code: "custom", path: ["starts_from"], message: "a scene with equipment or a person starts from a real photo (D-AD9)" });
  }
});
export type AdPresetRecipe = z.infer<typeof adPresetRecipeSchema>;

// ── the doors (C1 API; E2 draws the editors) ────────────────────────────────────────────────────
/**
 * A save: `kit_id` null starts a new kit (version 1) under `name`; otherwise it adds the next version
 * of that kit. The name is the parent row's and is given only when the kit is made — a save never
 * edits a row in place, so a rename is not a save (it arrives, if ever, as its own recorded act).
 */
export const adBrandKitSaveSchema = z.object({
  kit_id: recordId().nullable(),
  name: z.string().trim().min(1).max(120).optional(),
  kit: adBrandKitSchema,
}).refine((s) => (s.kit_id === null) === (s.name !== undefined), "a new kit is given a name; a new version of a kit is not");
export type AdBrandKitSave = z.infer<typeof adBrandKitSaveSchema>;

/**
 * A preset save adds the next version of the preset with this key, creating the preset on its first save.
 *
 * A NEW version must say both where its copy goes on the image (`overlay_slots`) and what the platform shows
 * beside it (`platform_slots`). The recipe leaves them nullable only so bodies saved before B2c still parse; a
 * version saved today without them would pass here and then be refused at compose (`no_overlay_slots`) or at
 * publish (`no_platform_slots`), so the door refuses it now. The editor (E2) reads these sentences from here.
 */
export const adPresetSaveSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{0,15}$/, "a preset's key is capitals, digits and underscores, like P2"),
  enabled: z.boolean(),
  recipe: adPresetRecipeSchema,
}).superRefine((s, ctx) => {
  if (!s.recipe.overlay_slots) ctx.addIssue({ code: "custom", path: ["recipe", "overlay_slots"], message: "Choose which copy goes on the image: its headline and its call to action." });
  if (!s.recipe.platform_slots) ctx.addIssue({ code: "custom", path: ["recipe", "platform_slots"], message: "Choose which copy Meta shows beside the image: its primary text and its headline." });
});
export type AdPresetSave = z.infer<typeof adPresetSaveSchema>;

export const adAssetAcceptSchema = z.object({ upload_id: recordId() });

export interface AdVersionView<T> {
  id: string;
  /** The parent's id (`ad_brand_kits.id` / `ad_concept_presets.id`). */
  parent_id: string;
  version: number;
  body: T;
  saved_at: string;
  saved_by_name: string;
}
export interface AdBrandKitView { id: string; name: string; archived_at: string | null; current: AdVersionView<AdBrandKit> | null }
export interface AdPresetView { id: string; key: string; archived_at: string | null; current: (AdVersionView<AdPresetRecipe> & { enabled: boolean }) | null }
