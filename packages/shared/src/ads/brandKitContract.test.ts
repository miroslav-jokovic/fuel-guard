import { describe, expect, it } from "vitest";
import { OVERLAY_HEADLINE_MAX_CHARS, OVERLAY_SMALL_LINE_MAX_CHARS } from "./copyCandidates.js";
import { adBrandKitSaveSchema, adBrandKitSchema, adPresetRecipeSchema, adPresetSaveSchema, conceptPair, conceptPairLabel, kitAssets, overlaySlotList, templateSlots, type AdBrandKit, type AdPresetRecipe } from "./brandKitContract.js";
import { safeZone } from "./renderGeometry.js";

/** Fixtures only — never a real brand value or preset (Q-AD14, Q-AD12 are the owner's). */
const KIT: AdBrandKit = {
  company_name: "Fixture Carrier", phone: null, colors: [{ name: "primary", hex: "#0B3D2E" }],
  logo: null, equipment_photos: [], overlays: {}, people_policy: "none", forbidden_marks: [],
};
const RECIPE: AdPresetRecipe = {
  name: "Fixture", hook_formula: "Lead with the figure.", copy_slots: [{ name: "hook", max_chars: 56 }, { name: "cta", max_chars: 30 }],
  image_prompt_template: "A {vehicle} at {time_of_day}, no text, no logos, no lettering", image_slots: ["vehicle", "time_of_day"],
  starts_from: "equipment_photo", shows_equipment: true, shows_people: false, motion_template: null, layout: "bottom_plate", formats: ["1:1"],
  overlay_slots: null,
  platform_slots: null,
  hook_family: "pay_first", scene_family: "equipment_at_rest",
};
const ASSET = { sha256: "a".repeat(64), format: "png", source_format: "svg", width: 10, height: 10, byte_size: 99 } as const;

describe("a preset's look (ADS-AD-LOOK-PLAN D-ADL11)", () => {
  it("a recipe saved before the looks still parses and names none; a named look is one of the two; any other word is refused", () => {
    const before = adPresetRecipeSchema.safeParse(RECIPE);
    expect(before.success && before.data.look).toBe(undefined);
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, look: "ribbon" }).success).toBe(true);
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, look: "rail" }).success).toBe(true);
    expect(adPresetRecipeSchema.safeParse({ ...RECIPE, look: "poster" }).error?.issues.map((i) => i.path.join("."))).toEqual(["look"]);
  });
});

describe("the two small lines on the image (ADS-AD-LOOK-PLAN D-ADL4)", () => {
  const six = { ...RECIPE, copy_slots: [...RECIPE.copy_slots, { name: "who", max_chars: 28 }, { name: "also", max_chars: 28 }, { name: "body", max_chars: 200 }, { name: "title", max_chars: 40 }] };
  const slots = (over: object) => ({ ...six, overlay_slots: { headline: "hook", cta: "cta", ...over }, platform_slots: { primary_text: "body", headline: "title" } });
  const issues = (r: object) => adPresetRecipeSchema.safeParse(r).error?.issues.map((i) => [i.path.join("."), i.message]) ?? [];

  it("a preset may name a slot for either, both or neither; absent and null both mean the line is not drawn", () => {
    for (const over of [{}, { kicker: "who" }, { subline: "also" }, { kicker: "who", subline: "also" }, { kicker: null, subline: null }]) expect(issues(slots(over)), JSON.stringify(over)).toEqual([]);
    expect(overlaySlotList({ headline: "hook", cta: "cta", kicker: "who", subline: "also" })).toEqual([["kicker", "who"], ["headline", "hook"], ["subline", "also"], ["cta", "cta"]]);
    expect(overlaySlotList({ headline: "hook", cta: "cta", kicker: null })).toEqual([["headline", "hook"], ["cta", "cta"]]);
  });

  it("a small line must be one of the copy slots, and no two lines on the image may read the same slot", () => {
    expect(issues(slots({ kicker: "nobody" }))).toEqual([["overlay_slots.kicker", "nobody is not one of copy_slots"]]);
    expect(issues(slots({ kicker: "hook" }))).toEqual([["overlay_slots", "each line on the image is a different slot"]]);
    expect(issues(slots({ kicker: "who", subline: "who" }))).toEqual([["overlay_slots", "each line on the image is a different slot"]]);
  });

  it("a slot drawn as a small line cannot also be the platform's text", () => {
    expect(issues({ ...slots({ kicker: "who" }), platform_slots: { primary_text: "who", headline: "title" } })).toEqual([["platform_slots.primary_text", "who is drawn on the image; the platform's text is another slot"]]);
  });

  it("the save refuses a small line allowed more than its one line holds, by name, and accepts one at the limit", () => {
    const save = (max: number, role: "kicker" | "subline") => adPresetSaveSchema.safeParse({ key: "P1", enabled: true, recipe: { ...slots({ [role]: "who" }), copy_slots: six.copy_slots.map((c) => (c.name === "who" ? { ...c, max_chars: max } : c)) } });
    expect(save(OVERLAY_SMALL_LINE_MAX_CHARS, "kicker").success).toBe(true);
    expect(save(OVERLAY_SMALL_LINE_MAX_CHARS + 1, "kicker").error?.issues.map((i) => i.message)).toEqual(["The small line above the headline (who) holds at most 28 characters: it is one line at one size."]);
    expect(save(OVERLAY_SMALL_LINE_MAX_CHARS + 1, "subline").error?.issues.map((i) => i.message)).toEqual(["The second line under the headline (who) holds at most 28 characters: it is one line at one size."]);
  });
});

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

  it("a new version must name its concept — both families, from the closed lists — though a stored recipe may not", () => {
    const four = { ...RECIPE, copy_slots: [...RECIPE.copy_slots, { name: "body", max_chars: 200 }, { name: "title", max_chars: 40 }] };
    const whole = { ...four, overlay_slots: { headline: "hook", cta: "cta" }, platform_slots: { primary_text: "body", headline: "title" } };
    const { hook_family: _h, scene_family: _s, ...older } = whole;
    const refused = adPresetSaveSchema.safeParse({ key: "P1", enabled: false, recipe: older });
    expect(refused.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      ["recipe.hook_family", "Choose what the first line leads with: pay, life, equipment, straight talk or proof."],
      ["recipe.scene_family", "Choose what the picture shows: the cab, the truck on the road, the truck at rest, a home street or a plain background."],
    ]);
    expect(adPresetSaveSchema.safeParse({ key: "P1", enabled: false, recipe: { ...whole, scene_family: undefined } }).error?.issues.map((i) => i.path.join("."))).toEqual(["recipe.scene_family"]);
    // A body stored before P1-6 is history: it parses, and has no pair to compare.
    expect(adPresetRecipeSchema.safeParse(older).success).toBe(true);
    expect(conceptPair(adPresetRecipeSchema.parse(older))).toBeNull();
    expect(conceptPair(whole)).toBe("pay_first+equipment_at_rest");
    expect(conceptPairLabel(whole)).toBe("pay first, truck at rest");
    // Closed lists: a family typed outside them is refused by the recipe itself.
    expect(adPresetRecipeSchema.safeParse({ ...whole, hook_family: "humour" }).success).toBe(false);
    expect(adPresetRecipeSchema.safeParse({ ...whole, scene_family: "beach" }).success).toBe(false);
  });

  it("a new version must hold a format an ad is shown in: 9:16 alone is refused in a sentence, 9:16 beside a feed format is kept", () => {
    const four = { ...RECIPE, copy_slots: [...RECIPE.copy_slots, { name: "body", max_chars: 200 }, { name: "title", max_chars: 40 }] };
    const whole = { ...four, overlay_slots: { headline: "hook", cta: "cta" }, platform_slots: { primary_text: "body", headline: "title" } };
    const storiesOnly = adPresetSaveSchema.safeParse({ key: "P1", enabled: true, recipe: { ...whole, formats: ["9:16"] } });
    expect(storiesOnly.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      ["recipe.formats", "Choose 4:5 or 1:1 as well: those are the formats an ad is shown in today, and 9:16 alone cannot be published."],
    ]);
    for (const formats of [["9:16", "4:5"], ["1:1"], ["1:1", "4:5", "9:16"]]) {
      expect(adPresetSaveSchema.safeParse({ key: "P1", enabled: true, recipe: { ...whole, formats } }).success).toBe(true);
    }
    // A stored body is history: the recipe parses, and compose stops it by name (`no_feed_format`).
    expect(adPresetRecipeSchema.safeParse({ ...whole, formats: ["9:16"] }).success).toBe(true);
    // The headline drawn on the image has a ceiling the overlay set (D-AD27); a slot that is not the headline does not.
    const long = { ...whole, copy_slots: whole.copy_slots.map((c) => (c.name === "hook" ? { ...c, max_chars: OVERLAY_HEADLINE_MAX_CHARS + 1 } : c)) };
    expect(adPresetSaveSchema.safeParse({ key: "P1", enabled: true, recipe: long }).error?.issues.map((i) => i.path.join("."))).toEqual(["recipe.copy_slots"]);
    expect(adPresetRecipeSchema.safeParse(long).success).toBe(true);
    // No formats at all keeps its own sentence, and only that one.
    expect(adPresetSaveSchema.safeParse({ key: "P1", enabled: true, recipe: { ...whole, formats: [] } }).error?.issues.map((i) => i.message)).toEqual(["choose at least one format"]);
  });
});

/**
 * The editors (E2) show a refusal's first message as it is. Zod's own default ("Invalid input", "Too small:
 * expected string to have >=1 characters") is what the brand kit drawer showed for a blank kit in the E2-finish
 * browser pass, so every rule a blank form reaches carries a sentence of its own.
 */
describe("a blank editor form is refused in words", () => {
  const ZOD_DEFAULT = /^(Invalid|Too (small|big)|expected)/;
  const blankKitSave = {
    kit_id: null, name: "",
    kit: { company_name: "", phone: "12", colors: [{ name: "", hex: "#000000" }], logo: null, equipment_photos: [{ label: "", asset: ASSET }], overlays: {}, people_policy: "none", forbidden_marks: ["x"] },
  };
  const blankPresetSave = {
    key: "P1", enabled: true,
    recipe: { ...RECIPE, name: "", hook_formula: "", copy_slots: [{ name: "hook", max_chars: null }, { name: "cta", max_chars: 5 }], image_prompt_template: "", image_slots: [], formats: [], overlay_slots: { headline: "hook", cta: "cta" }, platform_slots: null },
  };

  it("every refusal of a blank kit and a blank preset is a sentence, not Zod's default", () => {
    const issues = [...(adBrandKitSaveSchema.safeParse(blankKitSave).error?.issues ?? []), ...(adPresetSaveSchema.safeParse(blankPresetSave).error?.issues ?? [])];
    // Not vacuous: every field a blank form leaves empty was refused, each by its own rule.
    expect(issues.map((i) => i.path.join(".")).sort()).toEqual([
      "kit.colors.0.name", "kit.company_name", "kit.equipment_photos.0.label", "kit.forbidden_marks.0", "kit.phone", "name",
      "recipe.copy_slots.0.max_chars", "recipe.copy_slots.1.max_chars", "recipe.formats", "recipe.hook_formula", "recipe.image_prompt_template", "recipe.name",
    ]);
    // `recipe.platform_slots` is not among them: the save rule runs once the recipe itself parses, so the form shows
    // it after these. That rule has its own case in the describe above.
    expect(issues.filter((i) => ZOD_DEFAULT.test(i.message)).map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
  });
});
