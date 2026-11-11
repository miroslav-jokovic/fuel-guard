import { describe, expect, it } from "vitest";
import { FEED_FORMATS } from "@silvicom/shared";
import { HIGGSFIELD_ASPECT_INPUT, HIGGSFIELD_CREDIT_PRICES, HIGGSFIELD_IMAGE_INPUT, HIGGSFIELD_STILL_MODEL, SIMULATED_STILL_MODEL, stillParams } from "./prices.js";

/**
 * What a still's request says about the frame (AG4; Q-AD75), and the three tables a chosen model must be in.
 * No real model is chosen (V4, Q-AD20), so the last case passes today by `null` — it is here for the PR that
 * sets one.
 */
describe("stillParams — the picture is asked for in the frame it is shown in", () => {
  it("a model with a documented way to ask is sent the first published frame's shape, in its own field", () => {
    expect(stillParams(SIMULATED_STILL_MODEL, "a road", "4:5")).toEqual({ prompt: "a road", aspect_ratio: "4:5" });
    expect(stillParams(SIMULATED_STILL_MODEL, "a road", "1:1")).toEqual({ prompt: "a road", aspect_ratio: "1:1" });
  });

  it("a model with none, a preset with no published frame, and a shape the model does not take are each sent the prompt alone — never a guessed parameter", () => {
    expect(stillParams("some/unread-model", "a road", "4:5")).toEqual({ prompt: "a road" });
    expect(stillParams(SIMULATED_STILL_MODEL, "a road", null)).toEqual({ prompt: "a road" });
    expect(stillParams(SIMULATED_STILL_MODEL, "a road", "9:16")).toEqual({ prompt: "a road" });
  });

  it("every model that can be asked takes every format an ad is shown in", () => {
    for (const [model, aspect] of Object.entries(HIGGSFIELD_ASPECT_INPUT)) {
      for (const f of FEED_FORMATS) expect(aspect.value[f], `${model} ${f}`).toBeTruthy();
    }
  });

  it("the still model, once one is chosen, has its price, its image field and its frame field read from its page in the same change", () => {
    if (HIGGSFIELD_STILL_MODEL === null) return;
    expect(HIGGSFIELD_CREDIT_PRICES[HIGGSFIELD_STILL_MODEL]).toBeGreaterThan(0);
    expect(HIGGSFIELD_IMAGE_INPUT[HIGGSFIELD_STILL_MODEL]).toBeDefined();
    expect(HIGGSFIELD_ASPECT_INPUT[HIGGSFIELD_STILL_MODEL]).toBeDefined();
  });
});
