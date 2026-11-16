import { describe, expect, it } from "vitest";
import { MOTION_CLIP_MS } from "@silvicom/shared";
import { clipDollars, HIGGSFIELD_VIDEO_CANDIDATES, HIGGSFIELD_VIDEO_MODEL, motionClipParams } from "./videoModels.js";

const WAN = "alibaba/wan-3.0/image-to-video", SEEDANCE = "bytedance/seedance-2.0/image-to-video", KLING = "kling-video/v3.0/std/image-to-video";
const ask = { imageUrl: "https://files.example/first.png", prompt: "slow push in, dust in the light" };

describe("motionClipParams — one clip, asked the way each model's own page says", () => {
  it("each candidate gets the first frame, the prompt, five whole seconds and its own way of saying no sound", () => {
    expect(motionClipParams(WAN, ask)).toEqual({ ok: true, seconds: 5, params: { image_url: ask.imageUrl, prompt: ask.prompt, duration: 5, generate_audio: false } });
    expect(motionClipParams(SEEDANCE, ask)).toEqual({ ok: true, seconds: 5, params: { image_url: ask.imageUrl, prompt: ask.prompt, duration: 5, generate_audio: false } });
    expect(motionClipParams(KLING, ask)).toEqual({ ok: true, seconds: 5, params: { image_url: ask.imageUrl, prompt: ask.prompt, duration: 5, sound: "off" } });
  });

  it("no candidate is ever asked for sound, or for a shape: the picture is cut to the frame before it is sent", () => {
    for (const model of Object.keys(HIGGSFIELD_VIDEO_CANDIDATES)) {
      const r = motionClipParams(model, ask);
      if (!r.ok) throw new Error(`${model}: ${r.refusal}`);
      expect(Object.keys(r.params).filter((k) => /^(aspect_ratio|aspect|ratio|resolution)$/.test(k)), model).toEqual([]);
      expect([r.params.generate_audio, r.params.sound].filter((v) => v !== undefined), model).toEqual([expect.toSatisfy((v: unknown) => v === false || v === "off")]);
    }
  });

  it("the default length is the timeline's clip length, and every candidate takes it", () => {
    expect(MOTION_CLIP_MS).toBe(5000);
    for (const [model, f] of Object.entries(HIGGSFIELD_VIDEO_CANDIDATES)) {
      expect(f.seconds.min, model).toBeLessThanOrEqual(MOTION_CLIP_MS / 1000);
      expect(f.seconds.max, model).toBeGreaterThanOrEqual(MOTION_CLIP_MS / 1000);
    }
  });

  it("a length the model does not take is refused at each edge, never rounded to one it does", () => {
    expect(motionClipParams(SEEDANCE, { ...ask, clipMs: 4000 })).toMatchObject({ ok: true, seconds: 4 });
    expect(motionClipParams(SEEDANCE, { ...ask, clipMs: 3000 })).toEqual({ ok: false, refusal: "seconds_out_of_range" });
    expect(motionClipParams(SEEDANCE, { ...ask, clipMs: 15_000 })).toMatchObject({ ok: true, seconds: 15 });
    expect(motionClipParams(SEEDANCE, { ...ask, clipMs: 16_000 })).toEqual({ ok: false, refusal: "seconds_out_of_range" });
    expect(motionClipParams(WAN, { ...ask, clipMs: 2000 })).toMatchObject({ ok: true });
    expect(motionClipParams(KLING, { ...ask, clipMs: 2000 })).toEqual({ ok: false, refusal: "seconds_out_of_range" });
    expect(motionClipParams(KLING, { ...ask, clipMs: 5500 })).toEqual({ ok: false, refusal: "seconds_not_whole" });
  });

  it("an empty prompt is refused where the page says one must be sent, and left out where it need not be", () => {
    expect(motionClipParams(WAN, { ...ask, prompt: "  " })).toEqual({ ok: false, refusal: "prompt_missing" });
    expect(motionClipParams(KLING, { ...ask, prompt: "" })).toEqual({ ok: false, refusal: "prompt_missing" });
    expect(motionClipParams(SEEDANCE, { ...ask, prompt: " " })).toEqual({ ok: true, seconds: 5, params: { image_url: ask.imageUrl, duration: 5, generate_audio: false } });
  });

  it("a model whose page nobody read is refused, never asked with guessed fields", () => {
    expect(motionClipParams("some/unread-video-model", ask)).toEqual({ ok: false, refusal: "model_unread" });
    expect(clipDollars("some/unread-video-model")).toBeNull();
  });
});

describe("the candidates and the choice", () => {
  it("five seconds costs what the pricing page's figure gives, marked as a floor where the page gives one", () => {
    expect(clipDollars(WAN)).toEqual({ usd: 0.19, at_least: true });
    expect(clipDollars(SEEDANCE)).toEqual({ usd: 0.4, at_least: true });
    expect(clipDollars(KLING)).toEqual({ usd: 0.535, at_least: false });
    expect(clipDollars(KLING, 10_000)).toEqual({ usd: 1.07, at_least: false });
  });

  it("every candidate names the page its facts were read from", () => {
    for (const [model, f] of Object.entries(HIGGSFIELD_VIDEO_CANDIDATES)) expect(f.page, model).toMatch(/^https:\/\/docs\.higgsfield\.ai\/docs\/models\/.+\/.*image-to-video\.md$/);
  });

  it("no video model is chosen until the owner's sitting; the day one is, it is one whose page was read", () => {
    if (HIGGSFIELD_VIDEO_MODEL === null) return;
    expect(HIGGSFIELD_VIDEO_CANDIDATES[HIGGSFIELD_VIDEO_MODEL]).toBeDefined();
  });
});
