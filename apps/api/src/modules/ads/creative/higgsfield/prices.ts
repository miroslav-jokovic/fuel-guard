import type { AdFormat } from "@silvicom/shared";

/**
 * Higgsfield credits per model path (C3; workflow V4). EMPTY ON PURPOSE: the real prices are V4's
 * measurement against the owner's key (Q-AD20, gate G2), not yet made. A model missing here is refused
 * by `creditGate` (`price_unknown`) — a guessed price would let the monthly budget promise something it
 * cannot keep. Fill an entry only with a price read from Higgsfield's own pricing for that model, citing
 * the page and the date beside it. Tests inject their own table.
 */
export const HIGGSFIELD_CREDIT_PRICES: Readonly<Record<string, number>> = {};

/**
 * The Higgsfield model compose renders stills with (C5b2). NULL ON PURPOSE, for the same reason the price
 * table is empty: which model draws our trucks best, and at what price, is V4's measurement with the owner's
 * key (Q-AD20). Until then every compose on a real connection stops at the render with "no still model chosen
 * yet (V4)" — a visible refusal, never a model somebody picked by name. Set it with its price, in the same PR. A
 * simulator connection off production draws with `SIMULATED_STILL_MODEL` instead (`simulatedRender.ts`).
 */
export const HIGGSFIELD_STILL_MODEL: string | null = null;

/**
 * The simulator's still model (`simulatedRender.ts`), named here because `render.ts` reads the table below. Not a
 * Higgsfield path: nothing but the in-process fake answers it, and only off production.
 */
export const SIMULATED_STILL_MODEL = "simulator/still";

/**
 * Where each still model takes an input image (D-AD9 image-to-image), read from the model's own page on
 * 2026-11-04. These are documented FACTS about the models, not a choice: which one draws our stills stays
 * V4's (`HIGGSFIELD_STILL_MODEL`). A model missing here has no image input we have read, and a render that
 * must start from a kit photo is refused on it (`reference_unsupported`) rather than drawn from text alone.
 *   · `list`: the field is an array of public URLs; ours is the only entry.
 *   · `single`: the field is one public URL.
 * NOT here, on purpose: `higgsfield-ai/soul/v2/standard` and `higgsfield-ai/soul/standard` (their pages
 * list no image field — Soul V2's `custom_reference_id` is a trained character, not a photo), and
 * `marketing-studio/image` (it edits from up to 16 `image_urls` only "when enhance_prompt=false", and with
 * it true wants a preset, "product first" — a mode our params would have to set; added when V4 tries it).
 *   https://docs.higgsfield.ai/docs/models/grok-image-2/generate-and-edit.md — `image_urls`, 0–10, "supply up
 *       to 10 references for editing"
 *   https://docs.higgsfield.ai/docs/models/qwen-image-3/edit.md — `image_urls`, 1–3, "ordered public image
 *       URLs used as editing references"
 *   https://docs.higgsfield.ai/docs/models/ideogram-4/generate.md — `image_url`, "provide image_url for
 *       remix/editing"
 */
export const HIGGSFIELD_IMAGE_INPUT: Readonly<Record<string, { field: string; shape: "list" | "single" }>> = {
  "xai/grok-imagine-image-2.0": { field: "image_urls", shape: "list" },
  "alibaba/qwen-image-3/edit": { field: "image_urls", shape: "list" },
  "ideogram/v4.0": { field: "image_url", shape: "single" },
  // Ours, not a fact read from Higgsfield: the simulator takes the kit photo as the list models do.
  [SIMULATED_STILL_MODEL]: { field: "image_urls", shape: "list" },
};

/**
 * How each still model is asked for a frame's shape (AG4; Q-AD75, ruled 2026-11-10): the request field, and the
 * value it takes for each format we publish. Until AG4 the render sent `{ prompt }` alone, so the picture came
 * back in whatever shape the model defaults to and every format was cut out of its centre (audit F-AG3). Now
 * the first published format is asked for by name, and the picture is composed for the frame it is shown in.
 *
 * Like the image-input table above, an entry is a documented FACT about a model, read from its own page and
 * cited here — never a guess at a parameter name. No real model is listed yet because none is chosen (V4,
 * Q-AD20); the day `HIGGSFIELD_STILL_MODEL` is set, `prices.test.ts` fails until that model's entry is here, so
 * its page is read in the same PR as its price. A model with no entry is sent no shape and is cut as before.
 */
export const HIGGSFIELD_ASPECT_INPUT: Readonly<Record<string, { field: string; value: Partial<Record<AdFormat, string>> }>> = {
  // Ours, not a fact read from Higgsfield: the simulator draws the shape it is asked for (`drawSimulatedStill`).
  [SIMULATED_STILL_MODEL]: { field: "aspect_ratio", value: { "4:5": "4:5", "1:1": "1:1" } },
};

/** A still's request parameters: the prompt, and the frame's shape where this model has a documented way to ask. */
export function stillParams(model: string, prompt: string, frame: AdFormat | null): Record<string, unknown> {
  const aspect = HIGGSFIELD_ASPECT_INPUT[model];
  const value = frame ? aspect?.value[frame] : undefined;
  return aspect && value ? { prompt, [aspect.field]: value } : { prompt };
}
