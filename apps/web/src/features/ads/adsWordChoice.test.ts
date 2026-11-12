import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { AdsCreativeView } from "@silvicom/shared";
import AdsCreativeReview from "./AdsCreativeReview.vue";
import { choiceFrom, editableWords, lineErrors, overlayErrors, slotLabel } from "./adsWordChoice";

/**
 * Choosing an ad's words on the review screen (ADS-AD-LOOK-PLAN Q-ADL7): the editor opens on the ad's own copy or on
 * an offered one, sends every line trimmed with which copy it started from, and shows the door's refusals on the
 * line they name. The door's own suite (`routes/copyChoice.test.ts`) is where the words are judged.
 */
const COPY = { en: { hook: "Home every night", cta: "Apply now" }, es: { hook: "En casa cada noche", cta: "Aplica ya" } };
const OTHER = { en: { hook: "Home weekly, local runs", cta: "Apply today" }, es: { hook: "En casa cada semana", cta: "Aplica hoy" } };
const creative = (over: Partial<AdsCreativeView> = {}): AdsCreativeView => ({
  id: "cr-1", preset_version_id: "pv", brand_kit_version_id: "kv", supersedes_id: null, state: "ready", platform_status: null,
  copy: COPY, regenerations: 0, last_error: null, checks: null, created_at: "2026-11-12T12:00:00Z",
  candidates: { ranked: [COPY, OTHER].map((copy, i) => ({ copy, judged: null, total: null, offered_as: i })), chosen: 0, judge: null, offered: 2, passed: 2 },
  assets: [{ format: "4:5", language: "en", sha256: "a".repeat(64), path: "o/a.png", width: 1080, height: 1350, url: "https://store/a" }],
  ...over,
});
const review = (c: AdsCreativeView, canChooseWords = true, wordsRefusal: unknown = null) =>
  mount(AdsCreativeReview, { props: { creative: c, canDecide: true, busy: false, canChooseWords, wordsRefusal } });

describe("adsWordChoice — what the editor starts from and sends", () => {
  it("starts from a copy's own lines, sends them trimmed with the copy it started from, and labels a slot as a person reads it", () => {
    const words = editableWords(COPY)!;
    words.en.hook = "  Home every night, local  ";
    expect(choiceFrom(words, 1)).toEqual({ from_candidate: 1, copy: { en: { hook: "Home every night, local", cta: "Apply now" }, es: COPY.es } });
    expect(editableWords({ en: COPY.en })).toBeNull();
    expect(slotLabel("second_line")).toBe("Second line");
  });

  it("the door's findings become one sentence on the line they name, and the overlay's on the picture's room", () => {
    const detail = {
      copy: [
        { kind: "money_not_in_brief", language: "en", slot: "hook", text: "$0.95" },
        { kind: "too_long", language: "es", slot: "cta", length: 30, max_chars: 24 },
      ],
      overlay: [{ format: "4:5", language: "es", findings: [{ kind: "too_long", label: "headline" }] }],
    };
    expect(lineErrors(detail)).toEqual({
      "en.hook": 'This line names pay the opening does not offer ("$0.95").',
      "es.cta": "This line is 30 characters; this line holds 24.",
    });
    expect(overlayErrors(detail)).toEqual(["4:5 in Spanish: the headline needs a third line"]);
    expect([lineErrors(null), overlayErrors(undefined)]).toEqual([{}, []]);
  });
});

describe("AdsCreativeReview — choosing the words (Q-ADL7)", () => {
  it("an offered copy is used as offered: its words open in the editor, and saving sends them with its index", async () => {
    const w = review(creative());
    await w.find('[data-test="copy-candidates"] summary').trigger("click");
    expect(w.find('[data-test="use-1"]').exists()).toBe(false); // the ad's own copy is not offered again
    await w.find('[data-test="use-2"]').trigger("click");
    expect((w.find('[data-test="word-en-hook"]').element as HTMLTextAreaElement).value).toBe(OTHER.en.hook);
    await w.find('[data-test="words-save"]').trigger("click");
    expect(w.emitted("words")).toEqual([[{ from_candidate: 1, copy: OTHER }]]);
  });

  it("Edit the words opens the ad's own copy; a changed line is sent, and an emptied one cannot be", async () => {
    const w = review(creative());
    await w.find('[data-test="edit-words"]').trigger("click");
    await w.find('[data-test="word-en-cta"]').setValue("Apply in two minutes");
    await w.find('[data-test="words-save"]').trigger("click");
    expect(w.emitted("words")).toEqual([[{ from_candidate: null, copy: { en: { ...COPY.en, cta: "Apply in two minutes" }, es: COPY.es } }]]);
    await w.find('[data-test="word-es-hook"]').setValue("  ");
    expect(w.find('[data-test="words-save"]').attributes("disabled")).toBeDefined();
  });

  it("the door's refusal is shown on the line it names and above the lines when it is about room", async () => {
    const w = review(creative(), true, { copy: [{ kind: "term_not_in_brief", language: "en", slot: "hook", text: "home every night" }], overlay: [{ format: "4:5", language: "en", findings: [{ kind: "overflows", label: "headline" }] }] });
    await w.find('[data-test="edit-words"]').trigger("click");
    expect(w.text()).toContain('This line promises something the opening does not offer ("home every night").');
    expect(w.find('[data-test="words-room"]').text()).toContain("4:5 in English: the headline is too wide");
  });

  it("no word choice where it cannot apply: a person who cannot decide, or an ad that is not ready", () => {
    expect(review(creative(), false).find('[data-test="edit-words"]').exists()).toBe(false);
    expect(review(creative({ state: "approved" })).find('[data-test="edit-words"]').exists()).toBe(false);
  });

  it("a creative whose words a person chose says who, and whether they changed any", async () => {
    const chosen = creative({ candidates: { ...creative().candidates!, chosen: 1, chosen_by_person: { name: "Koni", edited_slots: ["cta"] } } });
    expect(review(chosen).find('[data-test="copy-candidates"] summary').text()).toContain("Koni chose the words, starting from #2 and changing cta.");
  });
});
