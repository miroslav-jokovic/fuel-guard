import { MOTION_CLIP_MS } from "@silvicom/shared";

/**
 * How a motion ad's clip is asked of each image-to-video model we may use (ADS-PLATFORM-V2-PLAN V4; Q-APX12,
 * ruled 2026-11-16: the model is chosen by a sitting on the owner's key, not by a price page).
 *
 * Like `prices.ts`'s tables, every entry is a documented FACT about a model, read from its own page on the date
 * beside it — never a guess at a parameter name. The three here are the sitting's candidates and nothing more:
 * `HIGGSFIELD_VIDEO_MODEL` stays NULL until the owner has looked at their clips, and until then a motion ad on a
 * real connection stops with "no video model chosen yet".
 *
 * ── WHAT IS NEVER ASKED FOR ───────────────────────────────────────────────────────────────────────
 * · SOUND. All three make sound unless told not to; each is told not to, in its own field (Q-APX15). The join
 *   drops any audio regardless (`motionJoin.ts`), so this saves what the sound would cost, not our safety.
 * · A SHAPE. None of the three can be asked for 4:5: Seedance has no aspect field ("Output framing follows
 *   image_url"), Kling's page names none, and Wan's list (16:9, 4:3, 1:1, 3:4, 9:16, adaptive) lacks it. So the
 *   picture is cut to the ad's frame BEFORE it is sent and no aspect is named. Whether each model then returns that
 *   frame is not stated on any of the pages; it is the first thing the sitting reads off the files, and the join
 *   covers the clip to the frame whatever comes back.
 *
 * ── THE PRICES ARE DOLLARS A SECOND, AND NOT YET A BUDGET ─────────────────────────────────────────
 * Read from https://open.higgsfield.ai/pricing on 2026-11-16. Two are marked as a floor: the page gives Wan as
 * "from", and Seedance's figure beside "480p" — what 1080p costs is not on the page. They size the sitting. They
 * are NOT wired to `creditGate`: the settings' monthly budget is in Higgsfield credits and the page speaks in
 * dollars, and how one becomes the other is read from the owner's account, not assumed (open, with Q-AD20).
 */
export const HIGGSFIELD_VIDEO_MODEL: string | null = null;

export interface VideoModelFacts {
  /** The request field the first frame's public URL goes in. */
  image_field: string;
  /** Whole seconds the model accepts. */
  seconds: { min: number; max: number };
  /** The field and value that turn generated sound off. */
  sound_off: Readonly<Record<string, string | boolean>>;
  /** Whether the page says a prompt must be sent. */
  prompt_required: boolean;
  usd_per_second: number;
  /** True when the page gives the figure as a floor ("from", or beside a lower resolution). */
  price_is_floor: boolean;
  /** The page the facts were read from. */
  page: string;
}

export const HIGGSFIELD_VIDEO_CANDIDATES: Readonly<Record<string, VideoModelFacts>> = {
  // "duration: 2-30 seconds", "generate_audio … default true", required: prompt, image_url.
  "alibaba/wan-3.0/image-to-video": {
    image_field: "image_url", seconds: { min: 2, max: 30 }, sound_off: { generate_audio: false }, prompt_required: true,
    usd_per_second: 0.038, price_is_floor: true, page: "https://docs.higgsfield.ai/docs/models/wan-3/image-to-video.md",
  },
  // "duration: 4 to 15", "generate_audio … default true", required: image_url; "Output framing follows image_url".
  "bytedance/seedance-2.0/image-to-video": {
    image_field: "image_url", seconds: { min: 4, max: 15 }, sound_off: { generate_audio: false }, prompt_required: false,
    usd_per_second: 0.08, price_is_floor: true, page: "https://docs.higgsfield.ai/docs/models/seedance-2/image-to-video.md",
  },
  // "duration: minimum 3, maximum 15", "sound: on or off and defaults to on"; "Always include a non-empty top-level prompt".
  "kling-video/v3.0/std/image-to-video": {
    image_field: "image_url", seconds: { min: 3, max: 15 }, sound_off: { sound: "off" }, prompt_required: true,
    usd_per_second: 0.107, price_is_floor: false, page: "https://docs.higgsfield.ai/docs/models/kling-3/standard-image-to-video.md",
  },
};

/**
 * The simulator's video model (`simulatedRender.ts`). Not a Higgsfield path and not a candidate: nothing but the
 * in-process fake answers it, only off production. Its "facts" are OURS — it is asked the way the candidates are
 * (a first frame, whole seconds, no sound) so a walk on staging runs the request a real model will get.
 */
export const SIMULATED_VIDEO_MODEL = "simulator/video";
const SIMULATED_VIDEO_FACTS: Pick<VideoModelFacts, "image_field" | "seconds" | "sound_off" | "prompt_required"> = {
  image_field: "image_url", seconds: { min: 2, max: 15 }, sound_off: { generate_audio: false }, prompt_required: false,
};
/** How a model is asked: a candidate's page, or the simulator's own. Prices are not here — `clipDollars` is the candidates' alone. */
const askedAs = (model: string) => (model === SIMULATED_VIDEO_MODEL ? SIMULATED_VIDEO_FACTS : HIGGSFIELD_VIDEO_CANDIDATES[model]);

export type ClipParamsRefusal = "model_unread" | "seconds_not_whole" | "seconds_out_of_range" | "prompt_missing";

/**
 * One clip's request: the first frame, how it should move, for how long, and no sound. A model whose page was not
 * read is refused, as an unpriced still model is; so is a length the model does not take — never rounded to one
 * it does, because the timeline was computed for the length asked.
 *
 * Without `imageUrl` the first frame's field is left out: that is how the render road asks (`render.ts`), which
 * uploads the picture itself, once, and writes the upload's URL into the field `clipImageField` names.
 */
export function motionClipParams(
  model: string, ask: { imageUrl?: string; prompt: string; clipMs?: number },
): { ok: true; params: Record<string, unknown>; seconds: number } | { ok: false; refusal: ClipParamsRefusal } {
  const facts = askedAs(model);
  if (!facts) return { ok: false, refusal: "model_unread" };
  const seconds = (ask.clipMs ?? MOTION_CLIP_MS) / 1000;
  if (!Number.isInteger(seconds)) return { ok: false, refusal: "seconds_not_whole" };
  if (seconds < facts.seconds.min || seconds > facts.seconds.max) return { ok: false, refusal: "seconds_out_of_range" };
  const prompt = ask.prompt.trim();
  if (!prompt && facts.prompt_required) return { ok: false, refusal: "prompt_missing" };
  return { ok: true, seconds, params: { ...(ask.imageUrl ? { [facts.image_field]: ask.imageUrl } : {}), ...(prompt ? { prompt } : {}), duration: seconds, ...facts.sound_off } };
}

/** What a clip of this length costs at the page's figure, in dollars — a floor where the page gives one. */
export function clipDollars(model: string, clipMs: number = MOTION_CLIP_MS): { usd: number; at_least: boolean } | null {
  const facts = HIGGSFIELD_VIDEO_CANDIDATES[model];
  return facts ? { usd: Math.round(facts.usd_per_second * (clipMs / 1000) * 1000) / 1000, at_least: facts.price_is_floor } : null;
}

/** Where this model takes its first frame, in the shape `render.ts` puts an uploaded picture's URL into a request. */
export function clipImageField(model: string): { field: string; shape: "single" } | undefined {
  const facts = askedAs(model);
  return facts ? { field: facts.image_field, shape: "single" } : undefined;
}
