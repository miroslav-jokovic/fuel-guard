import { describe, expect, it } from "vitest";
import { NO_LETTERING, REGENERATION_CLAUSES, artDirection, artPrecheck, composeImagePrompt, judgeArt, withRegenerationClauses } from "./artDirection.js";
import type { AdBrandKit, AdPresetRecipe } from "./brandKitContract.js";

/** Fixtures only — never a real brand value or preset (Q-AD14, Q-AD12). */
const photo = (c: string, label = "white tractor, side view") => ({ label, asset: { sha256: c.repeat(64), format: "jpeg" as const, source_format: "jpeg" as const, width: 10, height: 10, byte_size: 10 } });
const kit = (photos = [photo("a")], people_policy: AdBrandKit["people_policy"] = "none") => ({ equipment_photos: photos, people_policy });
const recipe = (o: Partial<AdPresetRecipe> = {}) => ({
  image_prompt_template: "Our tractor at {time_of_day}, no text, no logos, no lettering", image_slots: ["time_of_day"],
  starts_from: "equipment_photo" as const, shows_equipment: true, shows_people: false, ...o,
});
const kinds = (answer: Parameters<typeof judgeArt>[0], r = recipe(), k = kit()) => judgeArt(answer, r, k).map((f) => f.kind);

describe("artPrecheck — what is refused before any model is asked", () => {
  it("refuses a scene with equipment when the brand kit has no photo of ours", () => {
    expect(artPrecheck(recipe(), kit([]))).toBe("no_reference_photo");
  });
  it("refuses a scene with people when the people policy is none", () => {
    expect(artPrecheck(recipe({ shows_people: true }), kit([photo("a")], "none"))).toBe("people_policy_none");
    expect(artPrecheck(recipe({ shows_people: true }), kit([photo("a")], "varied"))).toBeNull();
  });
  it("lets a text-only scene through with no photos at all", () => {
    expect(artPrecheck(recipe({ starts_from: "text_only", shows_equipment: false }), kit([]))).toBeNull();
  });
});

describe("judgeArt — nothing that becomes letters reaches the image model", () => {
  it("accepts plain visual phrases and one of the kit's photos", () => {
    expect(kinds({ slots: { time_of_day: "dawn, soft light" }, reference_photo: "a".repeat(64) })).toEqual([]);
  });
  it.each([
    ["a digit", "dawn with $0.68 in the sky", "digit_in_slot"],
    ["a quotation", 'a sky that says "drive"', "quote_in_slot"],
    ["a logo", "dusk with the company logo", "lettering_in_slot"],
    ["a sign", "a road sign at dusk", "lettering_in_slot"],
    ["branding", "a branded trailer", "lettering_in_slot"],
    ["a billboard", "a billboard by the road", "lettering_in_slot"],
  ])("refuses a slot holding %s", (_label, value, kind) => {
    expect(kinds({ slots: { time_of_day: value }, reference_photo: "a".repeat(64) })).toContain(kind);
  });
  it("refuses a photo that is not this kit's, none for an equipment scene, and one for a text-only scene", () => {
    expect(kinds({ slots: { time_of_day: "dawn" }, reference_photo: "f".repeat(64) })).toEqual(["reference_not_in_kit"]);
    expect(kinds({ slots: { time_of_day: "dawn" }, reference_photo: null })).toEqual(["reference_required"]);
    expect(kinds({ slots: { time_of_day: "dawn" }, reference_photo: "a".repeat(64) }, recipe({ starts_from: "text_only", shows_equipment: false }))).toEqual(["reference_on_text_only"]);
  });
  it("refuses a missing slot, an extra slot and a paragraph in a slot", () => {
    expect(kinds({ slots: {}, reference_photo: "a".repeat(64) })).toEqual(["missing_slot"]);
    expect(kinds({ slots: { time_of_day: "dawn", mood: "calm" }, reference_photo: "a".repeat(64) })).toEqual(["unknown_slot"]);
    expect(kinds({ slots: { time_of_day: "x".repeat(121) }, reference_photo: "a".repeat(64) })).toEqual(["slot_too_long"]);
  });
  it("reads lettering words whole, so 'design' or 'signal' is not a sign", () => {
    expect(kinds({ slots: { time_of_day: "a signal light at dusk, clean design" }, reference_photo: "a".repeat(64) })).toEqual([]);
  });
});

describe("composeImagePrompt — every prompt ends with the no-lettering clause, once", () => {
  it("ends with it when the template already does, without saying it twice", () => {
    const p = composeImagePrompt("Our tractor at {time_of_day}, no text, no logos, no lettering", { time_of_day: "dawn" });
    expect(p).toBe(`Our tractor at dawn, ${NO_LETTERING}`);
  });
  it("adds it when the template does not", () => {
    expect(composeImagePrompt("Our tractor crossing a bridge at {time_of_day}.", { time_of_day: "dusk" })).toBe(`Our tractor crossing a bridge at dusk, ${NO_LETTERING}`);
  });
  it("hands on the kit's own photo as the reference", () => {
    const k = kit([photo("a"), photo("b", "reefer, rear")]);
    expect(artDirection({ slots: { time_of_day: "dawn" }, reference_photo: "b".repeat(64) }, recipe(), k).reference?.sha256).toBe("b".repeat(64));
  });
});

describe("withRegenerationClauses — the failure added to a regeneration's prompt (D-AD12)", () => {
  const prompt = composeImagePrompt("A white tractor on a highway at {time}", { time: "dusk" });
  it("adds our fixed phrase for each failed check, in checklist order, still ending with the clause once", () => {
    const out = withRegenerationClauses(prompt, ["safe_zone_clear", "no_glyphs"]);
    expect(out).toBe(`A white tractor on a highway at dusk, ${REGENERATION_CLAUSES.no_glyphs}, ${REGENERATION_CLAUSES.safe_zone_clear}, ${NO_LETTERING}`);
    expect(out.split(NO_LETTERING)).toHaveLength(2);
  });
  it("leaves the prompt unchanged when nothing failed", () => {
    expect(withRegenerationClauses(prompt, [])).toBe(prompt);
  });
  it("no clause holds a digit or a quotation, so a regeneration cannot ask for lettering", () => {
    for (const c of Object.values(REGENERATION_CLAUSES)) expect(c).not.toMatch(/[0-9"“”']/);
  });
});

