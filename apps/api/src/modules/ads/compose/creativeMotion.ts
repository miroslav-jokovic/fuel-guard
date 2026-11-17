import {
  MOTION_FORMAT, MOTION_FPS, motionTimeline, type AdAssetRef, type AdBrandKit, type AdBrief, type AdClipRef, type AdMotion, type AdPresetRecipe,
  type MotionTimeline,
} from "@silvicom/shared";
import { motionClipParams } from "../creative/higgsfield/videoModels.js";
import type { RenderInput, RenderOutcome } from "../creative/higgsfield/render.js";
import { clipKey } from "../creative/motion/motionClip.js";
import { checkMotionFrames, type MotionFrameFinding } from "../creative/motion/motionFrames.js";
import { joinMotion } from "../creative/motion/motionJoin.js";
import { frameStill, renderMotionLayers, type MotionLayersOutcome, type OverlayFinding, type OverlayLanguage } from "../creative/overlay/overlay.js";
import type { AdCopy } from "../workers/copywriter/copywriter.js";
import { drawnCopy } from "./creativePictures.js";

/**
 * A motion ad, made from a picture that already became an approved-quality still (ADS-PLATFORM-V2-PLAN V4;
 * Q-APX13). It adds nothing a person has not seen on the still: the same picture, the same words, the same
 * look — set moving, then settled on the still itself.
 *
 *   the picture ──► an image-to-video model's clip (the render road, `input.clip`: cut to the frame first)
 *   per language: the still's layers ──► the timeline ──► the check of the frames before the last ──► the join
 *   ──► one MP4 per language in `ad-assets`, and the record `ads_creatives.motion` will hold (0625)
 *
 * ONE clip serves both languages: the picture is the same, only the words differ, and a second clip would cost a
 * second charge to show a Spanish reader a different truck.
 *
 * ── EVERY WAY IT STOPS IS A STOP OF THE MOTION AD ONLY ────────────────────────────────────────────
 * The still passed its own checks before this was called and nothing here touches it. A caller decides what a
 * stopped motion ad means for the creative; this function only says why, in the words `last_error` can carry.
 *
 * ── THE CLIP MUST BE AS LONG AS IT WAS ASKED ──────────────────────────────────────────────────────
 * The join holds a clip's last frame (`motionPictureChain`), so a clip that came back short does not end early:
 * it FREEZES, and the words go on arriving over a dead picture (found 2026-11-17, V4f). A clip more than one
 * frame short of the timeline's length is refused here, at its price, rather than shown.
 *
 * ── HOW THE PICTURE IS TOLD TO MOVE IS OURS, AND IS ONE SENTENCE FOR EVERY AD ─────────────────────
 * `MOTION_DIRECTION`. No agent writes it: the Art director directs a still, and what it would say about motion
 * has never been asked, recorded or judged. Two of the three candidate models refuse a request with no prompt.
 * The sentence asks for the least a model can do — a slow move of the camera — and for the thing that matters
 * most to a carrier: that the truck stays the truck (D-AD9). Whether a model obeys it is the first thing the
 * sitting looks at (Q-APX12), and a direction per scene is its own step with its own recording.
 */

export const MOTION_DIRECTION =
  "Slow, steady camera push-in. The vehicle, its colours, markings and every object keep their exact shape and place. Nothing new appears. No text, no logos, no lettering, no people.";

const LANGUAGES: OverlayLanguage[] = ["en", "es"];
const FRAME_MS = 1000 / MOTION_FPS;

export interface MotionDeps {
  /** The render road (`queuedRender` in the worker): asked with `clip`, it answers a stored clip. */
  render: (input: RenderInput) => Promise<RenderOutcome>;
  /** The chosen image-to-video model, or null while none is (`HIGGSFIELD_VIDEO_MODEL`). */
  videoModel: string | null;
  readAsset: (orgId: string, ref: Pick<AdAssetRef, "sha256" | "format">) => Promise<Buffer>;
  readClip: (orgId: string, ref: Pick<AdClipRef, "sha256">) => Promise<Buffer>;
  storeClip: (orgId: string, bytes: Buffer) => Promise<AdClipRef>;
  ffmpeg?: string;
}

export interface MotionInput {
  ids: { orgId: string; campaignId: string; creativeId: string };
  /** The attempt and picture of the still this moves: the clip's row is keyed beside the still's. */
  attempt: number;
  picture: number;
  /** The render's stored picture the still was drawn on — what the model starts from. */
  base: Pick<AdAssetRef, "sha256" | "format">;
  brief: AdBrief;
  recipe: AdPresetRecipe;
  kit: AdBrandKit;
  /** The words of the still, both languages. */
  copy: AdCopy;
}

export type MotionChecks =
  | { ok: true; frames: number }
  | { ok: false; language: OverlayLanguage; findings: MotionFrameFinding[] };

export type MotionOutcome =
  | { kind: "made"; motion: AdMotion; checks: MotionChecks }
  | { kind: "pending"; why: string }
  | { kind: "stop"; reason: string; checks?: MotionChecks };

type Layers = Extract<MotionLayersOutcome, { kind: "rendered" }>;

const findingWords = (f: OverlayFinding[]) => f.map((x) => ("label" in x ? `${x.kind} (${x.label})` : x.kind)).join(", ");

export async function makeMotion(deps: MotionDeps, input: MotionInput): Promise<MotionOutcome> {
  const { ids, recipe, kit, brief } = input;
  const stop = (reason: string, checks?: MotionChecks): MotionOutcome => ({ kind: "stop", reason: reason.slice(0, 2000), ...(checks ? { checks } : {}) });
  if (!deps.videoModel) return stop("motion: no video model chosen yet (Q-APX12)");
  const slots = recipe.overlay_slots;
  if (!slots) return stop("motion: the preset names no words to draw");

  // 1. The words first: they cost nothing, and an ad whose words cannot be timed must not buy a clip.
  const picture = await deps.readAsset(ids.orgId, input.base);
  const still = await frameStill(picture, MOTION_FORMAT, recipe.layout);
  const logo = kit.logo ? await deps.readAsset(ids.orgId, kit.logo) : null;
  const drawn: Array<{ language: OverlayLanguage; layers: Layers; timeline: MotionTimeline }> = [];
  for (const language of LANGUAGES) {
    const layers = await renderMotionLayers({ format: MOTION_FORMAT, language, base: still, brief, kit, logo, layout: recipe.layout, look: recipe.look, ...drawnCopy(slots, input.copy[language]) });
    if (layers.kind !== "rendered") return stop(`motion render check (${MOTION_FORMAT}, ${language}): ${findingWords(layers.findings)}`);
    const timed = motionTimeline(layers.words);
    if (!timed.ok) return stop(`motion timeline (${language}): ${timed.findings.map((f) => (f.kind === "too_long" ? `too long, ${f.duration_ms / 1000} s of ${f.max_ms / 1000}` : f.kind)).join(", ")}`);
    drawn.push({ language, layers, timeline: timed.timeline });
  }
  // Both languages are timed over the same clip, so they ask for the same length of it.
  const clipMs = drawn[0]!.timeline.clip_ms;

  // 2. The clip: one request, on the still's own render road.
  const asked = motionClipParams(deps.videoModel, { prompt: MOTION_DIRECTION, clipMs });
  if (!asked.ok) return stop(`motion: ${asked.refusal}`);
  const render = await deps.render({
    ...ids, attempt: input.attempt, ...(input.picture > 1 ? { picture: input.picture } : {}), model: deps.videoModel, params: asked.params,
    reference: { sha256: input.base.sha256, format: input.base.format }, clip: { format: MOTION_FORMAT, layout: recipe.layout ?? "bottom_plate" },
  });
  if (render.kind === "pending") return { kind: "pending", why: `motion clip: ${render.why}` };
  if (render.kind === "refused") return stop(`motion clip: ${render.refusal}`);
  if (render.kind !== "stored") return stop(`motion clip: ${render.kind === "failed" ? render.errorCode : render.refusal}`);
  if (!render.clip) return stop("motion clip: no video");
  if (render.clip.duration_ms < clipMs - FRAME_MS) return stop(`motion clip: ${(render.clip.duration_ms / 1000).toFixed(1)} s came back for the ${clipMs / 1000} s asked`);
  const clip = await deps.readClip(ids.orgId, render.clip);

  // 3. Every language's frames are judged before any file is made: a motion ad is both languages or neither.
  let frames = 0;
  for (const d of drawn) {
    const checked = await checkMotionFrames({ clip, timeline: d.timeline, ground: d.layers.ground, blocks: d.layers.blocks, lines: d.layers.lines }, { ffmpeg: deps.ffmpeg });
    if (checked.kind === "refused") return stop(`motion check (${d.language}): ${checked.refusal}: ${checked.detail}`);
    if (checked.findings.length) {
      const said = checked.findings.map((f) => `${f.label} ${f.worst}:1 of ${f.required}:1 from ${(f.at_ms / 1000).toFixed(1)} s`).join(", ");
      return stop(`motion check (${d.language}): the words lose their contrast while the picture moves: ${said}`, { ok: false, language: d.language, findings: checked.findings });
    }
    frames = checked.frames;
  }

  // 4. The join, and the file kept by its bytes.
  const files: AdMotion["files"] = [];
  for (const d of drawn) {
    const joined = await joinMotion({ clip, timeline: d.timeline, under: d.layers.under, words: d.layers.words, still: d.layers.still }, { ffmpeg: deps.ffmpeg });
    if (joined.kind !== "joined") return stop(`motion join (${d.language}): ${joined.refusal}: ${joined.detail}`);
    const ref = await deps.storeClip(ids.orgId, joined.mp4);
    files.push({ ...ref, language: d.language, path: clipKey(ids.orgId, ref) });
  }
  return { kind: "made", motion: { format: MOTION_FORMAT, model: deps.videoModel, clip: render.clip, files, frames_checked: frames }, checks: { ok: true, frames } };
}
