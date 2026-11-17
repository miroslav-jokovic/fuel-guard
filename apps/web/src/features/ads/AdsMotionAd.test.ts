import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { AdMotionView, AdsCreativeView } from "@silvicom/shared";
import AdsCreativeReview from "./AdsCreativeReview.vue";
import AdsMotionAd from "./AdsMotionAd.vue";

/** The ad's video on the review screen (V4): a player when one was made, the reason when one was asked for and was not, nothing for a still. */
const clip = { sha256: "c".repeat(64), format: "mp4" as const, width: 1080, height: 1350, duration_ms: 7400, has_audio: true, byte_size: 900_000 };
const file = (language: "en" | "es", url: string | null) => ({ ...clip, language, path: `o/${language}.mp4`, url });
const MOTION: AdMotionView = { format: "4:5", model: "simulator/video", clip, frames_checked: 11, files: [file("en", "https://store/en.mp4"), file("es", "https://store/es.mp4")] };
const asset = (format: string, language: string, url: string | null) => ({ format, language, sha256: "a".repeat(64), path: `o/${format}-${language}.png`, width: 1080, height: 1350, url });
const creative = (over: Partial<AdsCreativeView> = {}): AdsCreativeView => ({
  id: "cr-1", preset_version_id: "pv", brand_kit_version_id: "kv", supersedes_id: null, state: "ready", platform_status: null,
  copy: { en: { hook: "Home every night" }, es: { hook: "En casa cada noche" } }, regenerations: 0, last_error: null, created_at: "2026-11-17T12:00:00Z",
  candidates: null, pairings: null, platform_text: null,
  assets: [asset("1:1", "en", "https://store/sq-en"), asset("4:5", "en", "https://store/feed-en"), asset("4:5", "es", "https://store/feed-es")],
  checks: { motion: { ok: true, frames: 11 } }, motion: MOTION, ...over,
});
const show = (c: AdsCreativeView, language: "en" | "es" = "en") => mount(AdsMotionAd, { props: { creative: c, language } });

describe("AdsMotionAd — the ad's video, per language", () => {
  it("plays that language's file, with the ad's own feed still as its poster, and loads nothing until play is pressed", () => {
    const en = show(creative()).find("[data-test=ad-video]");
    expect(en.attributes()).toMatchObject({ src: "https://store/en.mp4", poster: "https://store/feed-en", preload: "none", "aria-label": "Ad video, EN" });
    expect(en.attributes("controls")).toBeDefined();
    expect(en.attributes("autoplay")).toBeUndefined();
    // No speech to caption: the file's sound track is our silence, and the player says so to assistive tools.
    expect((en.element as HTMLVideoElement).muted).toBe(true);
    const es = show(creative(), "es").find("[data-test=ad-video]");
    expect(es.attributes()).toMatchObject({ src: "https://store/es.mp4", poster: "https://store/feed-es" });
  });

  it("says how long it is, that it has no sound, and that this is what is published", () => {
    const w = show(creative());
    expect(w.find("h4").text()).toBe("Video · 7.4 s · no sound");
    expect(w.find("[data-test=motion-note]").text()).toBe("This ad is published as this video. The picture above is its last frame and its thumbnail.");
  });

  it("a video whose link could not be made says so instead of drawing an empty player", () => {
    const w = show(creative({ motion: { ...MOTION, files: [file("en", null), file("es", "https://store/es.mp4")] } }));
    expect(w.find("[data-test=ad-video]").exists()).toBe(false);
    expect(w.find("[data-test=no-video]").text()).toBe("The video could not be loaded.");
  });

  it("asked for and not made: one sentence with compose's reason, saying the ad is the picture — and no player", () => {
    const w = show(creative({ motion: null, checks: { motion: { ok: false, reason: "motion clip: price_unknown" } } }));
    expect(w.find("[data-test=motion-not-made]").text()).toBe("The plan asked for a video here and none was made, so this ad is the picture above: clip: price_unknown.");
    expect(w.find("video").exists()).toBe(false);
  });

  it("a record of the video that cannot be read is never shown as made", () => {
    const w = show(creative({ motion: null, checks: { motion: "yes" } }));
    expect(w.find("[data-test=motion-not-made]").text()).toContain("the record of it could not be read");
  });

  it("a made video missing this language's file says it could not be found", () => {
    const w = show(creative({ motion: { ...MOTION, files: [file("en", "https://store/en.mp4")] } }), "es");
    expect(w.find("[data-test=no-video]").text()).toBe("The video for this language could not be found.");
  });

  it("a still — no record of a video at all — shows nothing", () => {
    for (const checks of [null, {}, { copy: { ok: true } }]) expect(show(creative({ motion: null, checks })).find("[data-test=motion-en]").exists()).toBe(false);
  });
});

describe("AdsCreativeReview — a motion ad", () => {
  const review = (c: AdsCreativeView) => mount(AdsCreativeReview, { props: { creative: c, canDecide: true, busy: false } });

  it("shows each language's video under that language's images; a still's review has none", () => {
    const w = review(creative());
    expect(w.findAll("[data-test=ad-video]").map((v) => v.attributes("src"))).toEqual(["https://store/en.mp4", "https://store/es.mp4"]);
    expect(w.findAll("[data-test=ad-image]")).toHaveLength(3);
    expect(review(creative({ motion: null, checks: null })).find("[data-test^=motion-]").exists()).toBe(false);
  });

  it("a server that sends no motion field at all (an older API during a deploy) is read as a still, not a crash", () => {
    const { motion: _gone, ...older } = creative({ checks: null });
    expect(review(older as AdsCreativeView).find("[data-test^=motion-]").exists()).toBe(false);
  });
});
