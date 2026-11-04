import { readFileSync } from "node:fs";
import sharp from "sharp";
import { z } from "zod";
import { AD_VISUAL_CHECKS, AI_MODELS, type AdBrandKit, type AdPresetRecipe, type AdVisualCheck } from "@silvicom/shared";
import { MAX_IMAGE_BYTES, type ForcedTool, type ImageFormat, type UserPart } from "../../../../lib/anthropic.js";
import { generateWithClaude, type ClaudeGenerationDeps, type ClaudeGenerationOutcome } from "../../generations/claudeGeneration.js";

/**
 * The Checker's visual check (ADS-AGENT-BUILD-WORKFLOW C5a; plan D-AD12 §2): Claude vision over the image a
 * creative was rendered from, answering the brand kit's closed checklist (`AD_VISUAL_CHECKS`) pass or fail,
 * each with a reason. The copy check (`judgeCopy`) and the render check (`renderOverlay`'s `checkRender`)
 * are pure and already exist; this is the third of D-AD12's three.
 *
 * ── THE IMAGE CHECKED IS THE STILL, NOT THE FINISHED AD ────────────────────────────────────────────
 * `no_glyphs` asks whether the generated picture holds writing. Our own overlay is writing, so the check
 * runs on the still as it fills the format's frame, BEFORE text is drawn — and `safe_zone_clear` is told
 * where that text will go (`text_band`) instead of seeing it. C5b passes the frame-filled still and the
 * band the overlay actually covered.
 *
 * ── WHICH ITEMS ARE ASKED IS OURS, NOT THE MODEL'S ─────────────────────────────────────────────────
 * The tool's schema holds exactly the items that apply, so the model can neither skip one (a missing
 * item is off-schema, never a pass) nor answer one that does not apply. `equipment_matches_reference`
 * applies when the preset shows equipment, and then a reference photo is required — the art director's
 * pre-check refuses the scene without one, so its absence here is refused too, asking no model. An item
 * that does not apply is recorded `not_applicable` with our reason, so the stored checks always list all
 * six (D-AD12: "each item answered pass/fail with a reason, stored with provenance").
 *
 * ── THE MODEL'S RECALL IS MEASURED, NEVER ASSUMED ──────────────────────────────────────────────────
 * Any `fail` fails the creative. Nothing here makes a pass trustworthy: `pnpm ads:eval checker` measures
 * recall per planted defect (§4R), and a person still approves every creative (D-AD12).
 *
 * ⚠ Two rules in `prompt.v1.md` are OUR reading, pending the owner's ruling (Q-AD27 in ADS-AGENT-PLAN.md):
 * a vehicle maker's grille badge is neither writing nor a foreign logo, and `equipment_matches_reference`
 * compares the TYPE (cab style, sleeper, tractor-trailer), not the make — measured 2026-11-04, a make rule
 * failed every clean image whose generated truck was not the reference photo's make.
 */

export const CHECKER_PROMPT_VERSION = "checker@1";
const PROMPT = readFileSync(new URL("./prompt.v1.md", import.meta.url), "utf8");
const MAX_TOKENS = 1500;

/**
 * The longest edge sent. Larger images are downscaled by the API before the model sees them (about
 * 1.15 megapixels), so sending more costs tokens and changes nothing; shrinking here also keeps the
 * hashed bytes equal to what was seen.
 */
export const VISION_LONG_EDGE = 1568;

export interface VisionImage { format: ImageFormat; bytes: Uint8Array }
/** A region as fractions (0–1) of the image's width and height, from its top-left corner. */
export interface FractionRect { x: number; y: number; width: number; height: number }

export interface VisualSubject {
  image: VisionImage;
  /** The kit photo the still was made from (D-AD9); null for a text-only scene. */
  reference: { image: VisionImage; label: string } | null;
  scene: Pick<AdPresetRecipe, "shows_equipment" | "shows_people">;
  kit: Pick<AdBrandKit, "people_policy" | "forbidden_marks">;
  text_band: FractionRect;
}

/**
 * A subject ready to send: images fitted, and the text band CUT OUT of the image by us. Measured
 * 2026-11-04: told the band as fractions, the model placed it wrongly both ways — a truck at 0.4 of the
 * height "had its wheels in" a band starting at 0.62, and a truck truly in the band "sat above it". So
 * the locating is ours (a pure crop) and the model only says what the crop shows.
 */
export interface PreparedSubject extends VisualSubject { band: VisionImage }

export type VisualVerdict = "pass" | "fail";
export type VisualAnswer = { checks: Partial<Record<AdVisualCheck, { reason: string; verdict: VisualVerdict }>> };
export type VisualResult = { check: AdVisualCheck; verdict: VisualVerdict | "not_applicable"; reason: string };

/** The items asked, in checklist order. */
export function applicableChecks(scene: VisualSubject["scene"]): AdVisualCheck[] {
  return AD_VISUAL_CHECKS.filter((c) => c !== "equipment_matches_reference" || scene.shows_equipment);
}

const NOT_APPLICABLE: Partial<Record<AdVisualCheck, string>> = {
  equipment_matches_reference: "the preset shows no equipment",
};

/**
 * The tool for the items asked. A reason's cap is a runaway bound, not a style rule: measured 2026-11-04
 * (`pnpm ads:eval checker`), the model wrote 218–542 characters when asked for one or two sentences, and a
 * 400 cap threw away two right answers as off-schema. The prompt asks for under 300; the schema allows 1000.
 */
export function visualTool(checks: AdVisualCheck[]): ForcedTool<VisualAnswer> {
  const item = z.object({ reason: z.string().trim().min(3).max(1000), verdict: z.enum(["pass", "fail"]) }).strict();
  return {
    name: "report_checks",
    description: "Answer every listed check about image 1: a short reason, then pass or fail.",
    schema: z.object({ checks: z.object(Object.fromEntries(checks.map((c) => [c, item]))).strict() }).strict() as unknown as z.ZodType<VisualAnswer>,
  };
}

/** The user turn: the image, the reference (labelled), the band cut from the image, then the checklist's data. */
export function visualUserParts(s: PreparedSubject): UserPart[] {
  const parts: UserPart[] = [{ type: "text", text: "Image 1 — the generated image:" }, { type: "image", ...s.image }];
  if (s.reference) parts.push({ type: "text", text: `Image 2 — a photo of our equipment, labelled: ${JSON.stringify(s.reference.label)}` }, { type: "image", ...s.reference.image });
  parts.push({ type: "text", text: "Image 3 — the band of image 1 our text will cover, cut out of it:" }, { type: "image", ...s.band });
  parts.push({
    type: "text",
    text: JSON.stringify({
      checks: applicableChecks(s.scene),
      people_allowed: s.scene.shows_people && s.kit.people_policy === "varied",
      forbidden_marks: s.kit.forbidden_marks,
    }, null, 2),
  });
  return parts;
}

export function buildVisualRequest(s: PreparedSubject) {
  return { model: AI_MODELS.deep, system: PROMPT, user: visualUserParts(s), tool: visualTool(applicableChecks(s.scene)), maxTokens: MAX_TOKENS };
}

/** Every checklist item, in order: the model's answer where it was asked, ours where it was not. Pure. */
export function judgeVisual(answer: VisualAnswer, scene: VisualSubject["scene"]): { ok: boolean; results: VisualResult[] } {
  const asked = new Set(applicableChecks(scene));
  const results = AD_VISUAL_CHECKS.map((check): VisualResult => {
    const a = asked.has(check) ? answer.checks[check] : undefined;
    if (!asked.has(check)) return { check, verdict: "not_applicable", reason: NOT_APPLICABLE[check]! };
    // The schema demands every asked item, so a gap means a caller skipped the parse: never a pass.
    if (!a) return { check, verdict: "fail", reason: "not answered" };
    return { check, verdict: a.verdict, reason: a.reason };
  });
  return { ok: results.every((r) => r.verdict !== "fail"), results };
}

/** Shrinks an image to `VISION_LONG_EDGE` (JPEG) only when it is larger, or over the API's byte ceiling. */
export async function fitForVision(img: VisionImage): Promise<VisionImage> {
  const meta = await sharp(img.bytes).metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longEdge <= VISION_LONG_EDGE && img.bytes.byteLength <= MAX_IMAGE_BYTES) return img;
  const bytes = await sharp(img.bytes).resize({ width: VISION_LONG_EDGE, height: VISION_LONG_EDGE, fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  return { format: "jpeg", bytes: new Uint8Array(bytes) };
}

/** The band of `image` that `rect` names, as its own image (pixels rounded inward-safe, at least 1×1). */
export async function cutBand(img: VisionImage, rect: FractionRect): Promise<VisionImage> {
  const meta = await sharp(img.bytes).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const left = Math.min(w - 1, Math.max(0, Math.round(rect.x * w)));
  const top = Math.min(h - 1, Math.max(0, Math.round(rect.y * h)));
  const width = Math.max(1, Math.min(w - left, Math.round(rect.width * w)));
  const height = Math.max(1, Math.min(h - top, Math.round(rect.height * h)));
  const bytes = await sharp(img.bytes).extract({ left, top, width, height }).jpeg({ quality: 85 }).toBuffer();
  return { format: "jpeg", bytes: new Uint8Array(bytes) };
}

/** Everything sent, derived from the subject: images fitted, then the band cut from the fitted image. */
export async function prepareSubject(s: VisualSubject): Promise<PreparedSubject> {
  const image = await fitForVision(s.image);
  const reference = s.reference ? { ...s.reference, image: await fitForVision(s.reference.image) } : null;
  return { ...s, image, reference, band: await cutBand(image, s.text_band) };
}

export interface CheckVisualInput {
  orgId: string;
  campaignId: string;
  creativeId: string;
  /** A creative is checked once per format; the key names it. */
  format: string;
  /** 1 for the first render; the one regeneration (D-AD12) is attempt 2, a new key. */
  attempt: number;
  subject: VisualSubject;
}

export type CheckVisualOutcome =
  | { kind: "passed"; generationId: string; results: VisualResult[]; replayed: boolean }
  /** `check_failed` (the creative's state of that name), not `failed`: that kind is the rail's, a call that errored. */
  | { kind: "check_failed"; generationId: string; results: VisualResult[]; replayed: boolean }
  /** A scene with equipment and no photo to compare it to: refused before any call. */
  | { kind: "no_reference" }
  | Exclude<ClaudeGenerationOutcome<VisualAnswer>, { kind: "succeeded" }>;

export async function checkVisual(deps: ClaudeGenerationDeps, input: CheckVisualInput): Promise<CheckVisualOutcome> {
  const s = input.subject;
  if (s.scene.shows_equipment && !s.reference) return { kind: "no_reference" };
  const subject = await prepareSubject(s);
  const out = await generateWithClaude(deps, {
    orgId: input.orgId,
    agent: "checker",
    campaignId: input.campaignId,
    creativeId: input.creativeId,
    idempotencyKey: `visual:${input.creativeId}:${input.format}:${input.attempt}`,
    promptVersion: CHECKER_PROMPT_VERSION,
    ...buildVisualRequest(subject),
  });
  if (out.kind !== "succeeded") return out;
  const v = judgeVisual(out.value, subject.scene);
  const checked = { generationId: out.generationId, results: v.results, replayed: out.replayed };
  return v.ok ? { kind: "passed", ...checked } : { kind: "check_failed", ...checked };
}
