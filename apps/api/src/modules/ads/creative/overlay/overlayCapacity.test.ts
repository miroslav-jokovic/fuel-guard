import { describe, expect, it, vi } from "vitest";
import { AD_FORMATS, AD_LOOKS, AD_OVERLAY_LAYOUTS, FEED_FORMATS, OVERLAY_HEADLINE_MAX_CHARS, OVERLAY_SMALL_LINE_MAX_CHARS, QUIET_REGION, adPresetSaveSchema, type AdBrandKit, type AdLook } from "@silvicom/shared";
import { COPYWRITER_EVAL, loadFixtures } from "../../workers/agentFixtures.js";
import { overlayFit } from "./overlay.js";
import { layOut } from "./overlayLayout.js";

/**
 * `OVERLAY_HEADLINE_MAX_CHARS` is a figure in shared about a renderer in the API (D-AD27): the preset save refuses
 * a headline slot above it, and shared cannot measure a font. This file is what holds the two together. It
 * re-measures, with the real overlay, every headline the copywriter's recorded fixtures hold — real model output
 * in English and Spanish, not strings written to fit — and fails when the figure is no longer what the overlay
 * does: after a template size, a safe zone or the bundled face changes, or after the fixtures are re-recorded.
 * Then the figure is measured again and changed in shared; it is never adjusted to make this pass.
 *
 * Re-measured 2026-11-10 for the looks (ADS-AD-LOOK-PLAN D-ADL3), and again 2026-11-12 for the three looks and Big
 * Shoulders (D-ADL16–19): `field` and `photo` share one face and the full measure, so they hold the same — the longest
 * recorded headline that fits is 58, the ceiling, with the ladder's floor at 80 (it was 67 at a floor of 66, which is
 * why the floor is 80: `overlayLooks.ts`). `number` holds what `field` holds, because a headline its column cannot
 * hold is drawn `field`. What the save promises is unchanged: nothing above the ceiling can be drawn by any look,
 * and 45 or fewer is drawn by every one.
 */
/**
 * The measuring tests lay out every recorded headline (hundreds, in two languages) on every format, layout and look
 * through the real overlay. About 2 s for the whole file on a laptop; on a loaded CI shard one test took 5,972 ms and
 * another 8,049 ms against vitest's 5,000 (2026-11-11, PRs #2233 and #2234). The work is real and nothing here waits on
 * a timer, so the limit is the file's own, as composeCreative.test.ts does for the same reason.
 */
vi.setConfig({ testTimeout: 30_000 });

const overlay = { zone: null, text_color: "#FFFFFF", plate_color: "#0B3D2E" };
const kit: Pick<AdBrandKit, "overlays"> = { overlays: Object.fromEntries(FEED_FORMATS.map((f) => [f, overlay])) };

const LENGTH = new Set(["too_long", "overflows", "stack_too_tall"]);
const recorded = loadFixtures(COPYWRITER_EVAL).flatMap(({ fixture }) => {
  const slot = fixture.input.recipe.overlay_slots?.headline ?? "hook";
  const out = fixture.recorded?.output as { candidates?: Array<Record<"en" | "es", Record<string, string>>> } | undefined;
  return (out?.candidates ?? []).flatMap((c) => (["en", "es"] as const).flatMap((language) => (c[language]?.[slot] ? [{ language, text: c[language][slot]!, brief: fixture.input.brief }] : [])));
});
const findingsOf = (h: (typeof recorded)[number], format: (typeof FEED_FORMATS)[number], layout: (typeof AD_OVERLAY_LAYOUTS)[number], look: AdLook = "field") =>
  overlayFit({ format, language: h.language, headline: h.text, cta: "Apply", brief: h.brief, kit, layout, look });
/**
 * A headline the claim check refuses never reaches the layout step (the overlay answers the claim and stops), so it
 * says nothing about room: left out, counted below. Everything else is judged on length alone.
 */
const headlines = recorded.filter((h) => findingsOf(h, "4:5", "bottom_plate").every((f) => LENGTH.has(f.kind)));
/** Measured once per headline, format, layout and look: three tests ask, and a measurement is a font shaping. */
const measured = new Map<string, boolean>();
const tooLong = (h: (typeof recorded)[number], format: (typeof FEED_FORMATS)[number], layout: (typeof AD_OVERLAY_LAYOUTS)[number], look: AdLook = "field") => {
  const key = `${h.language}|${h.text}|${format}|${layout}|${look}`;
  if (!measured.has(key)) measured.set(key, findingsOf(h, format, layout, look).some((f) => LENGTH.has(f.kind)));
  return measured.get(key)!;
};

describe("the two small lines' ceiling is the overlay's own (D-ADL4)", () => {
  const ov = Object.fromEntries(AD_FORMATS.map((f) => [f, overlay]));
  const fits = (role: "kicker" | "subline", text: string) => AD_LOOKS.every((look) => AD_FORMATS.every((format) =>
    overlayFit({ format, language: "en", headline: "Apply", cta: "Apply", [role]: text, brief: { claims: [] }, kit: { overlays: ov }, look }).length === 0));

  it("the limit's worth of any capital, digit or common mark fits both small lines in every look on every format", () => {
    for (const ch of "ABCDEFGHIJKLMNÑOPQRSTUVWXYZÁÉÍÓÚÜ·&-.,!?¡¿") {
      for (const role of ["kicker", "subline"] as const) expect(fits(role, ch.repeat(OVERLAY_SMALL_LINE_MAX_CHARS)), `${role} ${ch}`).toBe(true);
    }
  });

  it("the limit is the widest letter's, not a round number: one more W fits neither line everywhere", () => {
    for (const role of ["kicker", "subline"] as const) expect(fits(role, "W".repeat(OVERLAY_SMALL_LINE_MAX_CHARS + 1)), role).toBe(false);
  });
});

describe("the headline's ceiling is the overlay's own (D-AD27)", () => {
  it("the corpus is real and wide enough to measure with", () => {
    expect(recorded.length).toBeGreaterThanOrEqual(350);
    expect(headlines.length).toBeGreaterThanOrEqual(300);
    expect(Math.max(...headlines.map((h) => h.text.length))).toBeGreaterThan(OVERLAY_HEADLINE_MAX_CHARS);
  });

  it("on every published format, layout and look, no recorded headline longer than the ceiling fits, and the longest that fits is exactly the ceiling", () => {
    for (const look of AD_LOOKS) {
      for (const format of FEED_FORMATS) {
        for (const layout of AD_OVERLAY_LAYOUTS) {
          const fitting = headlines.filter((h) => !tooLong(h, format, layout, look)).map((h) => h.text.length);
          expect(Math.max(...fitting), `${look} ${format} ${layout}`).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_CHARS);
        }
      }
    }
    const best = Math.max(...AD_LOOKS.flatMap((look) => FEED_FORMATS.flatMap((format) => headlines.filter((h) => !tooLong(h, format, "bottom_plate", look)).map((h) => h.text.length))));
    expect(best).toBe(OVERLAY_HEADLINE_MAX_CHARS);
  });

  it("field, number and photo hold the same longest recorded headline: number falls back to field rather than refuse", () => {
    const longest = (look: AdLook) => Math.max(...FEED_FORMATS.flatMap((format) => headlines.filter((h) => !tooLong(h, format, "bottom_plate", look)).map((h) => h.text.length)));
    expect(AD_LOOKS.map(longest)).toEqual(AD_LOOKS.map(() => OVERLAY_HEADLINE_MAX_CHARS));
  });

  it("every recorded headline of 45 characters or fewer fits everywhere, in every look — the save's ceiling refuses nothing that plainly works", () => {
    for (const look of AD_LOOKS) {
      for (const format of FEED_FORMATS) {
        for (const layout of AD_OVERLAY_LAYOUTS) {
          expect(headlines.filter((h) => h.text.length <= 45 && tooLong(h, format, layout, look)).map((h) => h.text), `${look} ${format} ${layout}`).toEqual([]);
        }
      }
    }
  });

  it("the save refuses a headline slot above the ceiling by name, accepts one at it, and leaves the other slots alone", () => {
    const recipe = (max: number) => ({
      name: "Pay first", hook_formula: "Lead with the pay.", image_prompt_template: "A tractor on {road}", image_slots: ["road"],
      starts_from: "equipment_photo", shows_equipment: true, shows_people: false, motion_template: null, formats: ["4:5"],
      copy_slots: [{ name: "hook", max_chars: max }, { name: "cta", max_chars: 24 }, { name: "body", max_chars: 220 }, { name: "title", max_chars: 40 }],
      overlay_slots: { headline: "hook", cta: "cta" }, platform_slots: { primary_text: "body", headline: "title" },
      hook_family: "pay_first", scene_family: "equipment_on_road",
    });
    expect(adPresetSaveSchema.safeParse({ key: "P1", enabled: true, recipe: recipe(OVERLAY_HEADLINE_MAX_CHARS) }).success).toBe(true);
    expect(adPresetSaveSchema.safeParse({ key: "P1", enabled: true, recipe: recipe(OVERLAY_HEADLINE_MAX_CHARS + 1) }).error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      ["recipe.copy_slots", `The headline on the image (hook) holds at most ${OVERLAY_HEADLINE_MAX_CHARS} characters: a longer one needs a third line, and the image has room for two.`],
    ]);
  });
});

/**
 * The art director tells the image model which part of the picture to keep plain (`QUIET_REGION`, D-AD28) — and
 * the renderer decides where the words actually go. Until L4 the first said a third and the second covered 42 %
 * at the median; nothing compared them (ADS-AD-LOOK-PLAN D-ADL14). This measures, over every recorded headline
 * with its supporting line, how far from its edge a `bottom_plate` or `top_band` ad's words reach on the 4:5 frame the
 * picture is made for, and on the 1:1 cut from it (which keeps the words' edge, `frameStill`, so 1:1's reach is
 * scaled into the 4:5 picture's height). The footer is counted: it is below the stack, over the same picture.
 * Not held here: a preset that publishes 1:1 alone has its picture made square. That is the visual check's to judge
 * (`safe_zone_clear`, on the stack), which regenerates with the subject smaller.
 */
describe("the words stay inside the part of the picture the art director asks to keep plain (D-ADL14)", () => {
  const scaleTo45 = { "4:5": 1, "1:1": 1080 / 1350 } as const;
  // Colours and a phone: the footer row is drawn, and it lifts the stack.
  const full = { ...kit, colors: [{ name: "primary", hex: "#0B3D2E" }, { name: "accent", hex: "#F2B01E" }], phone: "(555) 010-0142" };
  it("on the 4:5 frame and the 1:1 cut from it, in every look, no recorded headline with its supporting line and the logo reaches past QUIET_REGION's share, and a third would be too little", () => {
    let widest = 0;
    for (const layout of ["bottom_plate", "top_band"] as const) {
      const share = QUIET_REGION[layout].share!;
      for (const look of AD_LOOKS) {
        for (const format of ["4:5", "1:1"] as const) {
          // The worst case: a supporting line under every headline, and the logo, which sits above a top_band stack.
          const reach = headlines.flatMap((h) => {
            const l = layOut({ format, language: h.language, headline: h.text, subline: "Solo or team, all lanes", cta: "Apply today", brief: h.brief, kit: full, layout, look, hasLogo: true });
            return l.ok ? [(layout === "bottom_plate" ? l.height - l.stack.y : l.stack.y + l.stack.height) / l.height * scaleTo45[format]] : [];
          });
          expect(reach.length, `${look} ${format} ${layout}`).toBeGreaterThan(250);
          expect(Math.max(...reach), `${look} ${format} ${layout}`).toBeLessThanOrEqual(share);
          widest = Math.max(widest, ...reach);
        }
      }
    }
    // Since the three looks (2026-11-12) no look draws a button or a label above the headline. Measured then: a
    // `bottom_plate` ad with a supporting line reaches 0.33–0.36 of the picture, a `top_band` one with the logo above
    // it 0.38–0.41. Half (D-ADL14) gave the picture away for nothing; a third would put the words on the subject.
    // So QUIET_REGION's share is 0.42 (ADS-AD-LOOK-PLAN Q-ADL10, art director v5), and this holds both sides of it.
    expect(widest).toBeGreaterThan(1 / 3);
  });
});
