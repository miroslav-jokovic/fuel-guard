import { describe, expect, it } from "vitest";
import { motionOpinion } from "./motionAd.js";

/** What the review screen says about an ad's video, from `checks.motion` as compose writes it (V4; `composeCreative` `motionOf`). */
describe("motionOpinion — was this ad's video made, and why not", () => {
  it("an ad never asked to move has no record, and the screen shows nothing", () => {
    expect([motionOpinion(undefined), motionOpinion(null)]).toEqual([null, null]);
  });

  it("made: compose's `{ ok: true, frames }`", () => {
    expect(motionOpinion({ ok: true, frames: 11 })).toEqual({ made: true, frames: 11 });
  });

  it.each([
    ["no model chosen", { ok: false, reason: "motion: no video model chosen yet (Q-APX12)" }, "no video model chosen yet (Q-APX12)"],
    ["the render road's word", { ok: false, reason: "motion clip: price_unknown" }, "clip: price_unknown"],
    ["a frame check's findings ride along", { ok: false, language: "es", findings: [{ label: "headline" }], reason: "motion check (es): the words lose their contrast while the picture moves: headline 2.1:1 of 3:1 from 1.5 s" }, "check (es): the words lose their contrast while the picture moves: headline 2.1:1 of 3:1 from 1.5 s"],
    ["a reason that does not open with compose's word is kept whole", { ok: false, reason: "emotional motion: none" }, "emotional motion: none"],
    ["no reason at all", { ok: false }, "no reason was recorded"],
  ])("not made (%s): compose's sentence, without its opening word", (_l, raw, why) => {
    expect(motionOpinion(raw)).toEqual({ made: false, why });
  });

  it("is never read as made unless it says ok AND how many frames were checked", () => {
    for (const raw of [{ ok: true }, { ok: true, frames: 0 }, { ok: "true", frames: 3 }, "made", 1, [], { frames: 11 }]) expect(motionOpinion(raw)?.made, JSON.stringify(raw)).toBe(false);
  });
});
