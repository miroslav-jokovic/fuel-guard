import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { AdsCreativeView } from "@silvicom/shared";
import AdsCreativeReview from "./AdsCreativeReview.vue";
import AdsFeedPreview from "./AdsFeedPreview.vue";

/**
 * The ad as a Facebook feed post on the review screen (V3 "preview as shown"). Which texts and which image is
 * shared's (`platformText`, `feedImageOf`, tested there); here: that the screen shows them, whole, in Meta's order,
 * and says when a text runs past Meta's own recommendation.
 */
const asset = (format: string, language: string) => ({ format, language, sha256: "a".repeat(64), path: `o/${format}-${language}.png`, width: 1080, height: 1350, url: `https://store/${format}-${language}` });
const LONG = "Class A over-the-road reefer runs out of our yard, paid by the mile every week, with newer trucks and freight you do not touch. Two weeks out, home for three days. Apply in two minutes.";
const creative = (over: Partial<AdsCreativeView> = {}): AdsCreativeView => ({
  id: "cr-1", preset_version_id: "pv", brand_kit_version_id: "kv", supersedes_id: null, state: "ready", platform_status: null,
  copy: { en: { hook: "Home weekly", cta: "Apply now" }, es: { hook: "En casa cada semana", cta: "Aplica ya" } },
  regenerations: 0, last_error: null, checks: null, created_at: "2026-11-16T12:00:00Z", candidates: null, pairings: null, motion: null,
  platform_text: { en: { primary_text: "Regional dry van. Home every weekend. $0.65 a mile.", headline: "Class A regional drivers" }, es: { primary_text: LONG, headline: "Conductores Clase A para rutas regionales" } },
  assets: [asset("1:1", "en"), asset("4:5", "en"), asset("1:1", "es")],
  ...over,
});
const frame = (c: AdsCreativeView, language: "en" | "es") => mount(AdsFeedPreview, { props: { creative: c, language } });

describe("AdsFeedPreview — the ad as Facebook is sent it", () => {
  it("shows the text above the picture, the 4:5 picture, the headline under it and the button, in that order", () => {
    const w = frame(creative(), "en");
    expect(w.find("[data-test=feed-primary]").text()).toBe("Regional dry van. Home every weekend. $0.65 a mile.");
    expect(w.find("[data-test=feed-image]").attributes("src")).toBe("https://store/4:5-en");
    expect(w.find("[data-test=feed-headline]").text()).toBe("Class A regional drivers");
    const html = w.html();
    const at = (s: string) => html.indexOf(s);
    expect([at("feed-primary"), at("feed-image"), at("feed-headline"), at("Apply now")].every((n, i, all) => n > 0 && (i === 0 || n > all[i - 1]!))).toBe(true);
    // Inside Meta's recommendations: nothing is said.
    expect(w.findAll("[data-test=feed-note]")).toHaveLength(0);
  });

  it("shows a long text whole and says it runs past what Meta recommends, with the count; the square picture when there is no 4:5", () => {
    const w = frame(creative(), "es");
    expect(w.find("[data-test=feed-primary]").text()).toBe(LONG);
    expect(w.find("[data-test=feed-image]").attributes("src")).toBe("https://store/1:1-es");
    expect(w.findAll("[data-test=feed-note]").map((n) => n.text())).toEqual([
      `The text above the picture is ${LONG.length} characters. Meta recommends 50 to 150, and shows only the start of a longer one until a person taps "See more".`,
      "The headline under the picture is 41 characters. Meta recommends 27; a longer one may be cut.",
    ]);
  });

  it("draws nothing for a language the ad has no texts in, and says so when the picture has no link", () => {
    expect(frame(creative({ platform_text: { en: null, es: null } }), "en").find("[data-test=feed-preview-en]").exists()).toBe(false);
    expect(frame(creative({ platform_text: null }), "en").html()).toBe("<!--v-if-->");
    const noLink = frame(creative({ assets: [{ ...asset("4:5", "en"), url: null }] }), "en");
    expect(noLink.find("[data-test=feed-no-image]").exists()).toBe(true);
    expect(noLink.find("[data-test=feed-image]").exists()).toBe(false);
  });
});

describe("AdsCreativeReview — the feed frame per language", () => {
  const review = (c: AdsCreativeView) => mount(AdsCreativeReview, { props: { creative: c, canDecide: true, busy: false } });
  it("offers the frame under each language that has its texts, and says it is a drawing and not Meta's preview", () => {
    const w = review(creative({ platform_text: { en: { primary_text: "Above.", headline: "Under" }, es: null } }));
    expect(w.find("[data-test=feed-en]").text()).toContain("A drawing of the feed, not Meta's own preview.");
    expect(w.find("[data-test=feed-en] [data-test=feed-preview-en]").exists()).toBe(true);
    expect(w.find("[data-test=feed-es]").exists()).toBe(false);
    expect(review(creative({ platform_text: null })).find("[data-test=feed-en]").exists()).toBe(false);
  });
});
