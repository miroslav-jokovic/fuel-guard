import { describe, expect, it } from "vitest";
import {
  AD_CAMERA_DISTANCES, AD_FOCAL_SUBJECTS, DISTANCE_CLAUSE, FOCAL_CLAUSE, FRAME_CLAUSE, NO_LETTERING, QUIET_REGION, REGENERATION_CLAUSES,
  artDirection, artPrecheck, composeImagePrompt, compositionClauses, judgeArt, withRegenerationClauses,
} from "./artDirection.js";
import { AD_OVERLAY_LAYOUTS } from "./brandKitContract.js";
import { AD_FORMATS } from "./renderGeometry.js";
import type { AdBrandKit, AdPresetRecipe } from "./brandKitContract.js";

/** Fixtures only — never a real brand value or preset (Q-AD14, Q-AD12). */
const photo = (c: string, label = "white tractor, side view") => ({ label, asset: { sha256: c.repeat(64), format: "jpeg" as const, source_format: "jpeg" as const, width: 10, height: 10, byte_size: 10 } });
const kit = (photos = [photo("a")], people_policy: AdBrandKit["people_policy"] = "none") => ({ equipment_photos: photos, people_policy });
const recipe = (o: Partial<AdPresetRecipe> = {}) => ({
  image_prompt_template: "Our tractor at {time_of_day}, no text, no logos, no lettering", image_slots: ["time_of_day"],
  starts_from: "equipment_photo" as const, shows_equipment: true, shows_people: false, layout: "bottom_plate" as const, formats: ["4:5" as const], ...o,
});
/** The two composition answers (AG3), as an equipment scene would give them. */
const SEEN = { focal_subject: "tractor", camera_distance: "medium" } as const;
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
    expect(kinds({ slots: { time_of_day: "dawn, soft light" }, reference_photo: "a".repeat(64), ...SEEN })).toEqual([]);
  });
  it.each([
    ["a digit", "dawn with $0.68 in the sky", "digit_in_slot"],
    ["a quotation", 'a sky that says "drive"', "quote_in_slot"],
    ["a logo", "dusk with the company logo", "lettering_in_slot"],
    ["a sign", "a road sign at dusk", "lettering_in_slot"],
    ["branding", "a branded trailer", "lettering_in_slot"],
    ["a billboard", "a billboard by the road", "lettering_in_slot"],
  ])("refuses a slot holding %s", (_label, value, kind) => {
    expect(kinds({ slots: { time_of_day: value }, reference_photo: "a".repeat(64), ...SEEN })).toContain(kind);
  });
  it("refuses a photo that is not this kit's, none for an equipment scene, and one for a text-only scene", () => {
    expect(kinds({ slots: { time_of_day: "dawn" }, reference_photo: "f".repeat(64), ...SEEN })).toEqual(["reference_not_in_kit"]);
    expect(kinds({ slots: { time_of_day: "dawn" }, reference_photo: null, ...SEEN })).toEqual(["reference_required"]);
    expect(kinds({ slots: { time_of_day: "dawn" }, reference_photo: "a".repeat(64), ...SEEN, focal_subject: "setting" }, recipe({ starts_from: "text_only", shows_equipment: false }))).toEqual(["reference_on_text_only"]);
  });
  it("refuses a missing slot, an extra slot and a paragraph in a slot", () => {
    expect(kinds({ slots: {}, reference_photo: "a".repeat(64), ...SEEN })).toEqual(["missing_slot"]);
    expect(kinds({ slots: { time_of_day: "dawn", mood: "calm" }, reference_photo: "a".repeat(64), ...SEEN })).toEqual(["unknown_slot"]);
    expect(kinds({ slots: { time_of_day: "x".repeat(121) }, reference_photo: "a".repeat(64), ...SEEN })).toEqual(["slot_too_long"]);
  });
  it("reads lettering words whole, so 'design' or 'signal' is not a sign", () => {
    expect(kinds({ slots: { time_of_day: "a signal light at dusk, clean design" }, reference_photo: "a".repeat(64), ...SEEN })).toEqual([]);
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
    expect(artDirection({ slots: { time_of_day: "dawn" }, reference_photo: "b".repeat(64), ...SEEN }, recipe(), k).reference?.sha256).toBe("b".repeat(64));
  });
});

describe("composition — where the subject goes and which part of the frame stays plain (AG3; D-AD28)", () => {
  const answer = { slots: { time_of_day: "dawn" }, reference_photo: "a".repeat(64), focal_subject: "tractor_and_trailer", camera_distance: "wide" } as const;

  it("the prompt carries the subject, the distance, the plain region of the preset's layout and the frame's shape, in that order, before the no-lettering clause", () => {
    const d = artDirection(answer, recipe({ layout: "top_band", formats: ["9:16", "1:1", "4:5"] }), kit());
    expect(d.prompt).toBe(`Our tractor at dawn, ${FOCAL_CLAUSE.tractor_and_trailer}, ${DISTANCE_CLAUSE.wide}, ${QUIET_REGION.top_band.clause}, ${FRAME_CLAUSE["4:5"]}, ${NO_LETTERING}`);
    expect(d.composition).toEqual({ focal_subject: "tractor_and_trailer", camera_distance: "wide", layout: "top_band", frame: "4:5" });
  });

  it("the plain region follows the layout, not the model: three layouts give three different clauses on one answer", () => {
    const prompts = AD_OVERLAY_LAYOUTS.map((layout) => artDirection(answer, recipe({ layout }), kit()).prompt);
    expect(new Set(prompts).size).toBe(AD_OVERLAY_LAYOUTS.length);
    for (const [i, layout] of AD_OVERLAY_LAYOUTS.entries()) expect(prompts[i]).toContain(QUIET_REGION[layout].clause);
  });

  it("the frame is the first format the publisher sends: a square-only preset is composed square, and 9:16 alone names no frame", () => {
    expect(artDirection(answer, recipe({ formats: ["1:1"] }), kit()).prompt).toContain(FRAME_CLAUSE["1:1"]);
    const none = artDirection(answer, recipe({ formats: ["9:16"] }), kit());
    expect(none.composition.frame).toBeNull();
    for (const f of AD_FORMATS) expect(none.prompt).not.toContain(FRAME_CLAUSE[f]);
  });

  it("a regeneration's clauses still go in before the no-lettering clause, after the composition", () => {
    const d = artDirection(answer, recipe(), kit());
    const again = withRegenerationClauses(d.prompt, ["safe_zone_clear"]);
    expect(again).toBe(`${d.prompt.slice(0, -(NO_LETTERING.length + 2))}, ${REGENERATION_CLAUSES.safe_zone_clear}, ${NO_LETTERING}`);
  });

  it("every word of both vocabularies and every layout and format has a clause, and no clause holds a digit, a quotation or a word that asks for lettering", () => {
    const all = [
      ...AD_FOCAL_SUBJECTS.map((s) => FOCAL_CLAUSE[s]), ...AD_CAMERA_DISTANCES.map((d) => DISTANCE_CLAUSE[d]),
      ...AD_OVERLAY_LAYOUTS.flatMap((l) => [QUIET_REGION[l].clause, QUIET_REGION[l].where]), ...AD_FORMATS.map((f) => FRAME_CLAUSE[f]),
    ];
    for (const c of all) {
      expect(c, c).toBeTruthy();
      expect(c).not.toMatch(/[0-9"“”']/);
      // Our own clauses through the judge a model's slot must pass: nothing in them may become letters.
      expect(kinds({ slots: { time_of_day: c }, reference_photo: "a".repeat(64), ...SEEN }).filter((k) => k !== "slot_too_long")).toEqual([]);
    }
    expect(compositionClauses({ focal_subject: "setting", camera_distance: "close", layout: "centered", frame: null })).toHaveLength(3);
  });

  it("refuses a subject the scene does not show: a person where the preset shows none, equipment where it shows none", () => {
    expect(kinds({ ...answer, focal_subject: "person_at_work" })).toEqual(["focal_subject_not_in_scene"]);
    expect(kinds({ ...answer, focal_subject: "person_at_work" }, recipe({ shows_people: true }))).toEqual([]);
    const textOnly = recipe({ starts_from: "text_only", shows_equipment: false });
    for (const s of ["tractor", "tractor_and_trailer", "trailer"] as const) expect(kinds({ ...answer, reference_photo: null, focal_subject: s }, textOnly)).toEqual(["focal_subject_not_in_scene"]);
    for (const s of ["road_ahead", "cab_interior", "setting"] as const) expect(kinds({ ...answer, reference_photo: null, focal_subject: s }, textOnly)).toEqual([]);
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

