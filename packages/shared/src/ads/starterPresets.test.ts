import { describe, expect, it } from "vitest";
import { AD_HOOK_FAMILIES, AD_LOOKS, AD_SCENE_FAMILIES, adPresetSaveSchema, conceptPair } from "./brandKitContract.js";
import { OVERLAY_HEADLINE_MAX_CHARS, OVERLAY_SMALL_LINE_MAX_CHARS } from "./copyCandidates.js";
import { publishedFormats } from "./renderGeometry.js";
import { STARTER_PRESETS } from "./starterPresets.js";

/** The starters are data a carrier adopts (Q-AD77): each must be a save the door accepts, as it is. */
describe("the five starter presets", () => {
  it("each one is a save adoptPresets can write: it parses by adPresetSaveSchema, switched off", () => {
    expect(STARTER_PRESETS.map((s) => s.key)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    for (const s of STARTER_PRESETS) {
      const parsed = adPresetSaveSchema.safeParse(s);
      expect(parsed.error?.issues ?? [], s.key).toEqual([]);
      expect(s.enabled, s.key).toBe(false);
    }
  });

  it("five distinct hook × scene pairs, and together they use every family of both lists once", () => {
    expect(new Set(STARTER_PRESETS.map((s) => conceptPair(s.recipe))).size).toBe(5);
    expect(STARTER_PRESETS.map((s) => s.recipe.hook_family).sort()).toEqual([...AD_HOOK_FAMILIES].sort());
    expect(STARTER_PRESETS.map((s) => s.recipe.scene_family).sort()).toEqual([...AD_SCENE_FAMILIES].sort());
  });

  it("each is a still in the feed formats, with three to five image slots and a headline the image has room for", () => {
    for (const { key, recipe } of STARTER_PRESETS) {
      expect(publishedFormats(recipe.formats), key).toEqual(["4:5", "1:1"]);
      expect(recipe.motion_template, key).toBeNull();
      expect(recipe.image_slots.length, key).toBeGreaterThanOrEqual(3);
      expect(recipe.image_slots.length, key).toBeLessThanOrEqual(5);
      expect(recipe.image_prompt_template.endsWith("no text, no logos, no lettering"), key).toBe(true);
      const headline = recipe.copy_slots.find((c) => c.name === recipe.overlay_slots!.headline)!;
      expect(headline.max_chars, key).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_CHARS);
    }
  });

  it("two of the five compose with no equipment photo in the kit, so an empty kit is not an empty Campaigns tab", () => {
    expect(STARTER_PRESETS.filter((s) => s.recipe.starts_from === "text_only").map((s) => s.key)).toEqual(["P1", "P2"]);
  });

  it("each names a look: pay first draws number, equipment and proof draw field, the life-led and straight-talk ones photo", () => {
    expect(STARTER_PRESETS.map((s) => [s.key, s.recipe.hook_family, s.recipe.look])).toEqual([
      ["P1", "straight_talk", "photo"], ["P2", "pay_first", "number"], ["P3", "life_first", "photo"], ["P4", "equipment_first", "field"], ["P5", "proof", "field"],
    ]);
    expect(new Set(STARTER_PRESETS.map((s) => s.recipe.look))).toEqual(new Set(AD_LOOKS));
  });

  it("three use a small line, each a slot of its own at the overlay's limit, and the formula says what goes on it", () => {
    const small = STARTER_PRESETS.flatMap(({ key, recipe }) => {
      const o = recipe.overlay_slots!;
      return [["kicker", o.kicker], ["subline", o.subline]].filter(([, slot]) => slot).map(([role, slot]) => {
        const c = recipe.copy_slots.find((s) => s.name === slot)!;
        expect(c.max_chars, `${key} ${role}`).toBe(OVERLAY_SMALL_LINE_MAX_CHARS);
        expect(Object.values(recipe.platform_slots ?? {}), `${key} ${slot} is the image's alone`).not.toContain(slot);
        expect(recipe.hook_formula, key).toMatch(role === "kicker" ? /small line above/ : /second line/);
        return `${key}:${role}`;
      });
    });
    expect(small).toEqual(["P2:kicker", "P3:subline", "P5:subline"]);
  });

  it("every hook formula says what to do when the brief lacks the fact it leads with", () => {
    for (const { key, recipe } of STARTER_PRESETS) expect(recipe.hook_formula, key).toMatch(/\bIf the brief (states|says) (no|nothing|only)/);
  });
});
