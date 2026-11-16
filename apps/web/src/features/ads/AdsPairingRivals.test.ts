import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { AdPairingsView, AdsCreativeView } from "@silvicom/shared";
import AdsCreativeReview from "./AdsCreativeReview.vue";
import AdsPairingRivals from "./AdsPairingRivals.vue";

/**
 * The pairings an ad was chosen from, on the review screen (V3 "show few"), and using another one. What is said
 * about a score is `adRivals`'s (shared, tested there); here: that the screen says it, and what a pick sends.
 */
const picture = (n: number, dropped: string | null = null) => ({ picture: n, attempt: 1, reference: null, focal_subject: "tractor" as const, camera_distance: "medium" as const, dropped });
const pairing = (pic: number, words: number, total: number | null, url: string | null = `https://store/${pic}-${words}`) => ({
  picture: pic, words, judged: null, total, preview: url === null ? null : { sha256: "a".repeat(64), path: `o/${pic}-${words}.png`, width: 1080, height: 1350, url },
});
const PAIRINGS: AdPairingsView = {
  format: "4:5", judge: "finishedAdJudge@1", chosen: 0,
  pictures: [picture(1), picture(2, "art check: repeats_earlier_picture"), picture(3)],
  ranked: [pairing(1, 0, 17), pairing(3, 1, 18), pairing(3, 0, 14), pairing(1, 1, null, null)],
};
const show = (pairings: AdPairingsView = PAIRINGS, canChoose = true) => mount(AdsPairingRivals, { props: { pairings, canChoose, busy: false } });

describe("AdsPairingRivals — what the ad was chosen from", () => {
  it("lists every pairing best first with its picture, copy and score, marks the ad, and calls a pairing one point away as good — never second", () => {
    const w = show();
    expect(w.find("[data-test=rivals-summary]").text()).toContain("Chosen from 3 pictures: 4 pairings of a picture and words. Ranked by the finished-ad judge; the first became the ad.");
    expect(w.findAll("[data-test^=rival-]").filter((x) => /^rival-\d+$/.test(x.attributes("data-test")!))).toHaveLength(4);
    expect(w.find("[data-test=rival-1]").text()).toContain("Picture 1 · copy #1");
    expect(w.find("[data-test=rival-1] [data-test=rival-score]").text()).toBe("17 of 20");
    expect(w.find("[data-test=rival-1] [data-test=rival-chosen]").text()).toBe("This is the ad");
    // 18 against the ad's 17: the screen does not call it better, or the ad second.
    expect(w.find("[data-test=rival-2]").text()).toContain("Picture 3 · copy #2");
    expect(w.find("[data-test=rival-2] [data-test=rival-score]").text()).toBe("18 of 20");
    expect(w.find("[data-test=rival-2] [data-test=rival-as-good]").text()).toBe("As good");
    expect(w.find("[data-test=rival-3] [data-test=rival-as-good]").exists()).toBe(false);
    expect(w.find("[data-test=rivals-margin]").text()).toContain("within 1 point of the best score");
    expect(w.text()).not.toMatch(/second|better|worse/i);
  });

  it("a pairing the judge did not score says so, one with no image says so, and a picture that was not used says why", () => {
    const w = show();
    expect(w.find("[data-test=rival-4] [data-test=rival-score]").text()).toBe("Not scored");
    expect(w.find("[data-test=rival-4] [data-test=rival-no-image]").exists()).toBe(true);
    expect(w.find("[data-test=rival-1] [data-test=rival-image]").attributes("src")).toBe("https://store/1-0");
    expect(w.findAll("[data-test=rival-unused]").map((p) => p.text())).toEqual(["Picture 2 was made and not used: art check: repeats_earlier_picture"]);
  });

  it("with no ranking it says the judge did not run and calls nothing as good", () => {
    const w = show({ ...PAIRINGS, judge: null, ranked: [pairing(1, 0, null), pairing(3, 0, null)] });
    expect(w.find("[data-test=rivals-summary]").text()).toContain("Not ranked: the finished-ad judge did not run, so the first picture with the first copy became the ad.");
    expect(w.findAll("[data-test=rival-as-good]")).toHaveLength(0);
    expect(w.find("[data-test=rivals-margin]").exists()).toBe(false);
  });

  it("using another pairing asks first, says no picture is made again, and sends that picture and those words; cancel sends nothing", async () => {
    const w = show();
    expect(w.find("[data-test=rival-use-1]").exists()).toBe(false);
    await w.find("[data-test=rival-use-2]").trigger("click");
    expect(w.emitted("pick")).toBeUndefined();
    expect(w.find("[data-test=rival-confirm]").text()).toContain("replaced by picture 3 with copy #2. The picture is not made again");
    // The one picked is marked where it is, and it alone.
    expect(w.findAll("[data-test=rival-picked]")).toHaveLength(1);
    expect(w.find("[data-test=rival-2] [data-test=rival-picked]").text()).toBe("You picked this one");
    // While one is being confirmed no other is offered.
    expect(w.findAll("[data-test^=rival-use-]")).toHaveLength(0);
    await w.find("[data-test=rival-cancel]").trigger("click");
    expect(w.emitted("pick")).toBeUndefined();
    await w.find("[data-test=rival-use-3]").trigger("click");
    await w.find("[data-test=rival-confirm-use]").trigger("click");
    expect(w.emitted("pick")).toEqual([[{ picture: 3, words: 0 }]]);
  });

  it("a person who cannot decide the ad is shown the pairings and offered none", () => {
    const w = show(PAIRINGS, false);
    expect(w.find("[data-test=rival-1]").exists()).toBe(true);
    expect(w.findAll("[data-test^=rival-use-]")).toHaveLength(0);
  });
});

describe("AdsCreativeReview — an ad chosen from several pictures", () => {
  const A = { en: { hook: "Home every night", cta: "Apply now" }, es: { hook: "En casa cada noche", cta: "Aplica ya" } };
  const B = { en: { hook: "Home weekly, local runs ", cta: "Apply today" }, es: { hook: "En casa cada semana", cta: "Aplica hoy" } };
  const creative = (over: Partial<AdsCreativeView> = {}): AdsCreativeView => ({
    id: "cr-1", preset_version_id: "pv", brand_kit_version_id: "kv", supersedes_id: null, state: "ready", platform_status: null,
    copy: A, regenerations: 0, last_error: null, checks: null, created_at: "2026-11-16T12:00:00Z", pairings: PAIRINGS,
    candidates: { ranked: [A, B].map((copy, i) => ({ copy, judged: null, total: null, offered_as: i })), chosen: 0, judge: null, offered: 2, passed: 2 },
    assets: [{ format: "4:5", language: "en", sha256: "a".repeat(64), path: "o/a.png", width: 1080, height: 1350, url: "https://store/a" }],
    ...over,
  });
  const review = (c: AdsCreativeView, canChooseWords = true) => mount(AdsCreativeReview, { props: { creative: c, canDecide: true, busy: false, canChooseWords } });

  it("picking a rival sends its words as they were offered, trimmed, with the copy they are and the picture named", async () => {
    const w = review(creative());
    await w.find("[data-test=rival-use-2]").trigger("click");
    await w.find("[data-test=rival-confirm-use]").trigger("click");
    expect(w.emitted("words")).toEqual([[{ from_candidate: 1, copy: { en: { hook: "Home weekly, local runs", cta: "Apply today" }, es: B.es }, picture: 3 }]]);
  });

  it("an ad made from one picture shows no such section, and editing the words still names no picture", async () => {
    const w = review(creative({ pairings: null }));
    expect(w.find("[data-test=rivals]").exists()).toBe(false);
    await w.find("[data-test=edit-words]").trigger("click");
    await w.find("[data-test=words-save]").trigger("click");
    expect((w.emitted("words")![0]![0] as object)).not.toHaveProperty("picture");
  });

  it("the pairings are offered only where the words are: not on an ad already decided, and not to someone who cannot choose", () => {
    expect(review(creative({ state: "approved" })).findAll("[data-test^=rival-use-]")).toHaveLength(0);
    expect(review(creative(), false).findAll("[data-test^=rival-use-]")).toHaveLength(0);
    expect(review(creative()).findAll("[data-test^=rival-use-]")).toHaveLength(3);
  });
});
