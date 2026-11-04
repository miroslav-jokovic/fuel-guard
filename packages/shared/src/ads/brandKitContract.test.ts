import { describe, expect, it } from "vitest";
import { adBrandKitSaveSchema, adBrandKitSchema, adPresetRecipeSchema, kitAssets, templateSlots, type AdBrandKit, type AdPresetRecipe } from "./brandKitContract.js";
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
});
