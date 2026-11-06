import { describe, expect, it } from "vitest";
import { adBrandKitSaveSchema, adBrandKitSchema, adPresetRecipeSchema, adPresetSaveSchema, kitAssets, templateSlots, type AdBrandKit, type AdPresetRecipe } from "./brandKitContract.js";
import { safeZone } from "./renderGeometry.js";

/** Fixtures only — never a real brand value or preset (Q-AD14, Q-AD12 are the owner's). */
const KIT: AdBrandKit = {
  company_name: "Fixture Carrier", phone: null, colors: [{ name: "primary", hex: "#0B3D2E" }],
  logo: null, equipment_photos: [], overlays: {}, people_policy: "none", forbidden_marks: [],
};
const RECIPE: AdPresetRecipe = {
  name: "Fixture", hook_formula: "Lead with the figure.", copy_slots: [{ name: "hook", max_chars: 60 }, { name: "cta", max_chars: 30 }],
  image_prompt_template: "A {vehicle} at {time_of_day}, no text, no logos, no lettering", image_slots: ["vehicle", "time_of_day"],
  starts_from: "equipment_photo", shows_equipment: true, shows_people: false, motion_template: null, formats: ["1:1"],
  overlay_slots: null,
  platform_slots: null,
};
const ASSET = { sha256: "a".repeat(64), format: "png", source_format: "svg", width: 10, height: 10, byte_size: 99 } as const;

describe("brand kit contract", () => {
  it("lets a kit tighten a format's safe zone, never widen it", () => {
    const zone = safeZone("9:16");
    const inside = { ...zone, x: zone.x + 10, width: zone.width - 20 };
    const outside = { ...zone, y: zone.y - 1 };
    expect(adBrandKitSchema.safeParse({ ...KIT, overlays: { "9:16": { zone: inside, text_color: "#FFFFFF", plate_color: null } } }).success).toBe(true);
    const bad = adBrandKitSchema.safeParse({ ...KIT, overlays: { "9:16": { zone: outside, text_color: "#FFFFFF", plate_color: null } } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["overlays", "9:16", "zone"]);
  });

  it("refuses a colour that is not six hex digits and a people policy outside the closed list", () => {
    expect(adBrandKitSchema.safeParse({ ...KIT, colors: [{ name: "x", hex: "green" }] }).success).toBe(false);
    expect(adBrandKitSchema.safeParse({ ...KIT, people_policy: "young" }).success).toBe(false);
  });

  it("lists every asset a kit names: the logo and each equipment photo", () => {
    expect(kitAssets({ ...KIT, logo: ASSET, equipment_photos: [{ label: "tractor front", asset: { ...ASSET, sha256: "b".repeat(64) } }] }).map((a) => a.sha256))
      .toEqual(["a".repeat(64), "b".repeat(64)]);
  });

  it("names a kit only when it is made — a new version carries no name", () => {
    expect(adBrandKitSaveSchema.safeParse({ kit_id: null, name: "Main", kit: KIT }).success).toBe(true);
    expect(adBrandKitSaveSchema.safeParse({ kit_id: null, kit: KIT }).success).toBe(false);
    expect(adBrandKitSaveSchema.safeParse({ kit_id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "Renamed", kit: KIT }).success).toBe(false);
  });
});

describe("preset recipe contract", () => {
  it("names the overlay's headline and call to action among its copy slots, or leaves them unsaid", () => {
    // A preset saved before C5b has no such key: it still parses, as "not said".
    const { overlay_slots: _absent, ...savedBefore } = RECIPE;
    expect(adPresetRecipeSchema.parse(savedBefore).overlay_slots).toBeNull();
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, overlay_slots: { headline: "hook", cta: "cta" } }).success).toBe(true);
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, overlay_slots: { headline: "pay", cta: "cta" } }).success).toBe(false);
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, overlay_slots: { headline: "cta", cta: "cta" } }).success).toBe(false);
  });

  it("names the platform's primary text and headline among the copy slots the overlay does not draw, or leaves them unsaid", () => {
    const four = { ...RECIPE, copy_slots: [...RECIPE.copy_slots, { name: "body", max_chars: 200 }, { name: "title", max_chars: 40 }], overlay_slots: { headline: "hook", cta: "cta" } };
    const { platform_slots: _absent, ...savedBefore } = four;
    expect(adPresetRecipeSchema.parse(savedBefore).platform_slots ?? null).toBeNull();
    expect(adPresetRecipeSchema.safeParse({ ...four, platform_slots: { primary_text: "body", headline: "title" } }).success).toBe(true);
    expect(adPresetRecipeSchema.safeParse({ ...four, platform_slots: { primary_text: "pay", headline: "title" } }).success).toBe(false);
    expect(adPresetRecipeSchema.safeParse({ ...four, platform_slots: { primary_text: "body", headline: "hook" } }).success).toBe(false);
    expect(adPresetRecipeSchema.safeParse({ ...four, platform_slots: { primary_text: "body", headline: "body" } }).success).toBe(false);
  });

  it("accepts a recipe whose template uses exactly its declared slots", () => {
    expect(templateSlots(RECIPE.image_prompt_template)).toEqual(["vehicle", "time_of_day"]);
    expect(adPresetRecipeSchema.safeParse(RECIPE).success).toBe(true);
  });

  it("refuses a template slot nobody declared, and a declared slot the template never uses", () => {
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, image_slots: ["vehicle"] }).error?.issues[0]?.message).toMatch(/\{time_of_day\} is not one of image_slots/);
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, image_slots: [...RECIPE.image_slots, "weather"] }).error?.issues[0]?.message).toMatch(/weather is never used/);
  });

  it("refuses a text-only scene that shows equipment or a person (D-AD9)", () => {
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, starts_from: "text_only" }).success).toBe(false);
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, starts_from: "text_only", shows_equipment: false, shows_people: true }).success).toBe(false);
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, starts_from: "text_only", shows_equipment: false }).success).toBe(true);
  });

  it("refuses a format or a slot listed twice", () => {
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, formats: ["1:1", "1:1"] }).success).toBe(false);
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, copy_slots: [{ name: "hook", max_chars: 60 }, { name: "hook", max_chars: 60 }] }).success).toBe(false);
  });

  it("a new version must say where its copy goes on the image and beside it, though a stored recipe may not", () => {
    const four = { ...RECIPE, copy_slots: [...RECIPE.copy_slots, { name: "body", max_chars: 200 }, { name: "title", max_chars: 40 }] };
    const whole = { ...four, overlay_slots: { headline: "hook", cta: "cta" }, platform_slots: { primary_text: "body", headline: "title" } };
    expect(adPresetSaveSchema.safeParse({ key: "P1", enabled: true, recipe: whole }).success).toBe(true);
    const noOverlay = adPresetSaveSchema.safeParse({ key: "P1", enabled: true, recipe: { ...whole, overlay_slots: null, platform_slots: whole.platform_slots } });
    expect(noOverlay.error?.issues.map((i) => i.path.join("."))).toEqual(["recipe.overlay_slots"]);
    const noPlatform = adPresetSaveSchema.safeParse({ key: "P1", enabled: true, recipe: { ...whole, platform_slots: null } });
    expect(noPlatform.error?.issues.map((i) => i.path.join("."))).toEqual(["recipe.platform_slots"]);
    // The recipe itself still parses without them: a body saved before B2c is history, not an error.
    expect(adPresetRecipeSchema.safeParse({ ...whole, overlay_slots: null, platform_slots: null }).success).toBe(true);
  });
});
