import {
  FORMAT_SIZE, overlaySlotList, publishedFormats, withRegenerationClauses,
  type AdBrandKit, type AdBrief, type AdFormat, type AdPresetRecipe, type AdVisualCheck, type ArtAnswer,
} from "@silvicom/shared";
import type { ClaudeGenerationDeps } from "../generations/claudeGeneration.js";
import { stillParams } from "../creative/higgsfield/prices.js";
import type { RenderInput, RenderOutcome } from "../creative/higgsfield/render.js";
import { frameStill, renderOverlay, type OverlayFinding, type OverlayLanguage } from "../creative/overlay/overlay.js";
import { directArt } from "../workers/artDirector/artDirector.js";
import { checkVisual, type FractionRect, type VisionImage, type VisualResult } from "../workers/checker/checker.js";
import type { AdCopy } from "../workers/copywriter/copywriter.js";

/**
 * One PICTURE of a creative, moved as far as it can go (ADS-PLATFORM-V2-PLAN V3 "make many, show few"; Q-APX7).
 * Until V3 a creative was one picture; `composeCreative` held this loop and stopped the creative when it stopped.
 * It is its own unit now because a creative makes several, and one picture that cannot be used — its direction
 * refused, its check failed after every regeneration — no longer ends the creative while another can.
 *
 *   for attempt a = 1 … 1 + max_regenerations:
 *     art (a; told the earlier pictures of this ad; from a 2nd attempt on, our fixed clause per failed check)
 *     → render (a; still drawing = `pending`)
 *     → per published format: the still framed; every set of words drawn on it in English and Spanish (the render
 *       check); the visual check over the framed still, with the band ANY of those words cover
 *   → `passed` with every drawn image in memory, or `dropped` with the reason.
 *
 * ── SEVERAL SETS OF WORDS ON ONE PICTURE ───────────────────────────────────────────────────────────
 * The words that fit the layout (D-AD26) are each drawn on the picture, because contrast is the picture's: a
 * headline the layout holds can still be unreadable over THIS sky. Words the overlay refuses here are left out of
 * this picture's pairings and say why; the picture is dropped only when it can carry none of them. The visual
 * check's "is the band clear" is asked once per format about the union of every band drawn, so one answer covers
 * every pairing of the picture — a picture that keeps the widest band clear keeps each one clear.
 *
 * ── WHAT THE NEXT PICTURE IS TOLD ──────────────────────────────────────────────────────────────────
 * `answer` is this picture's FIRST direction, handed back even while its render is still drawing, so the next
 * picture can be directed and queued in the same run. The first and not the last: a regeneration re-asks under a
 * new key, and what an earlier picture "was" must not change between two runs of the same step, or a replayed
 * direction would have been asked something different from what its row records.
 *
 * Every call is keyed by creative, picture and attempt (`pictureKeyPart`): picture 1 keeps the keys every creative
 * had before V3. Nothing here writes `ads_creatives` — that stays `composeCreative`'s (`onRendered` is its
 * `generating → checking`).
 */

const LANGUAGES: OverlayLanguage[] = ["en", "es"];

/** One set of words to draw: its place in `candidates.ranked` (0 for a person's own words) and in the writer's order. */
export interface WordsToDraw { index: number; offeredAs: number; copy: AdCopy }
export interface DrawnImage { format: AdFormat; language: OverlayLanguage; png: Buffer }
export interface DrawnWords { words: WordsToDraw; images: DrawnImage[] }
export type VisualHistory = Array<{ attempt: number; visual: Record<string, VisualResult[]> }>;

export interface PictureDeps extends ClaudeGenerationDeps {
  render: (input: RenderInput) => Promise<RenderOutcome>;
  renderModel: string | null;
  readAsset: (orgId: string, ref: { sha256: string; format: "jpeg" | "png" | "webp" }) => Promise<Buffer>;
}

export interface PictureInput {
  ids: { orgId: string; campaignId: string; creativeId: string };
  brief: AdBrief;
  recipe: AdPresetRecipe;
  kit: AdBrandKit;
  maxRegenerations: number;
  idea: string | null;
  /** Which of the creative's pictures this is, from 1. */
  picture: number;
  /** The first directions of this ad's earlier pictures, oldest first. */
  earlier: readonly ArtAnswer[];
  words: readonly WordsToDraw[];
  /**
   * A person's choice keeps a picture of the creative it replaces (Q-ADL7): that picture's art and render rows are
   * replayed by their keys at attempt 1, so nothing is asked again and nothing is paid twice.
   */
  reuse?: { creativeId: string; picture: number; attempt: number };
  onRendered: () => Promise<void>;
}

export type PictureOutcome =
  | { kind: "pending"; why: string; answer: ArtAnswer | null }
  /** `checks` is what the creative's `checks` holds if this was its only picture (the copy check aside). */
  | { kind: "dropped"; reason: string; checks: Record<string, unknown>; attempt: number; answer: ArtAnswer | null }
  | {
    kind: "passed"; attempt: number; answer: ArtAnswer; visual: Record<string, VisualResult[]>; history: VisualHistory;
    /** The words this picture carries, each drawn in every published format and both languages. */
    drawn: DrawnWords[];
    /** The words the overlay refused on THIS picture, by their index, with why. */
    undrawable: Array<{ index: number; reason: string }>;
    logo: VisionImage | null; subject: string;
  };

export async function makePicture(deps: PictureDeps, input: PictureInput): Promise<PictureOutcome> {
  let failed: AdVisualCheck[] = [];
  let answer: ArtAnswer | null = null;
  const history: VisualHistory = [];
  for (let attempt = 1; attempt <= 1 + input.maxRegenerations; attempt += 1) {
    const r = await oneAttempt(deps, input, attempt, failed);
    answer = answer ?? r.answer;
    if (r.kind === "pending") return { kind: "pending", why: r.why, answer };
    if (r.kind === "stop") return { kind: "dropped", reason: r.reason, checks: { ...r.checks, visual_attempts: history }, attempt, answer };
    history.push({ attempt, visual: r.visual });
    if (r.kind === "passed") return { kind: "passed", attempt, answer: r.answer, visual: r.visual, history, drawn: r.drawn, undrawable: r.undrawable, logo: r.logo, subject: r.subject };
    failed = r.failed;
  }
  const said = Object.entries(history.at(-1)!.visual).flatMap(([format, rs]) => rs.filter((x) => x.verdict === "fail").map((x) => `${format} ${x.check}: ${x.reason}`));
  return {
    kind: "dropped", attempt: history.length, answer,
    reason: `visual check failed after ${history.length} attempt(s): ${said.join(" · ")}`.slice(0, 2000),
    checks: { render: { ok: true }, visual: { ok: false }, visual_attempts: history },
  };
}

type Attempt =
  | { kind: "pending"; why: string; answer: ArtAnswer | null }
  | { kind: "stop"; reason: string; checks?: Record<string, unknown>; answer: ArtAnswer | null }
  | { kind: "passed"; answer: ArtAnswer; visual: Record<string, VisualResult[]>; drawn: DrawnWords[]; undrawable: Array<{ index: number; reason: string }>; logo: VisionImage | null; subject: string }
  | { kind: "visual_failed"; answer: ArtAnswer; visual: Record<string, VisualResult[]>; failed: AdVisualCheck[] };

async function oneAttempt(deps: PictureDeps, input: PictureInput, attempt: number, failedBefore: AdVisualCheck[]): Promise<Attempt> {
  const { ids, brief, recipe, kit, picture } = input;
  const reused = attempt === 1 ? input.reuse ?? null : null;
  const from = reused ? { ...ids, creativeId: reused.creativeId } : ids;
  const fromAttempt = reused ? reused.attempt : attempt, fromPicture = reused ? reused.picture : picture;
  const slots = recipe.overlay_slots!;
  const art = await directArt(deps, {
    ...from, attempt: fromAttempt, picture: fromPicture, earlier: input.earlier, recipe, kit, context: brief.subject_matter.details,
    // The headline the picture is composed around is the best-ranked words': one direction serves every pairing.
    headline: input.words[0]!.copy.en[slots.headline] ?? null, idea: input.idea,
  });
  if (art.kind === "in_flight") return { kind: "pending", why: `art ${attempt} in flight`, answer: null };
  if (art.kind === "not_possible") return { kind: "stop", reason: `art: ${art.reason}`, answer: null };
  if (art.kind === "refused") return { kind: "stop", reason: `art check: ${art.findings.map((f) => f.kind).join(", ")}`, answer: null };
  if (art.kind !== "ready") return { kind: "stop", reason: `art: ${stopCode(art)}`, answer: null };
  const answer = art.answer;

  if (!deps.renderModel) return { kind: "stop", reason: "render: no still model chosen yet (V4)", answer };
  const prompt = withRegenerationClauses(art.direction.prompt, failedBefore);
  const ref = art.direction.reference;
  const render = await deps.render({
    ...from, attempt: fromAttempt, ...(fromPicture > 1 ? { picture: fromPicture } : {}), model: deps.renderModel,
    params: stillParams(deps.renderModel, prompt, art.direction.composition.frame), reference: ref ? { sha256: ref.sha256, format: ref.format } : null,
  });
  if (render.kind === "pending") return { kind: "pending", why: `render ${attempt}: ${render.why}`, answer };
  if (render.kind === "refused") return { kind: "stop", reason: `render: ${render.refusal}`, answer };
  if (render.kind !== "stored") return { kind: "stop", reason: `render: ${render.kind === "failed" ? render.errorCode : render.refusal}`, answer };
  if (render.assets.length === 0) return { kind: "stop", reason: "render: no image", answer };
  await input.onRendered();

  const base = await deps.readAsset(ids.orgId, render.assets[0]!);
  const logo = kit.logo ? await deps.readAsset(ids.orgId, kit.logo) : null;
  const photo = ref ? kit.equipment_photos.find((p) => p.asset.sha256 === ref.sha256) ?? null : null;
  const reference = photo ? { label: photo.label, image: { format: photo.asset.format, bytes: new Uint8Array(await deps.readAsset(ids.orgId, photo.asset)) } } : null;

  const visual: Record<string, VisualResult[]> = {};
  const failed = new Set<AdVisualCheck>();
  const drawn: DrawnWords[] = input.words.map((words) => ({ words, images: [] }));
  const refused = new Map<number, { format: AdFormat; language: OverlayLanguage; findings: OverlayFinding[] }>();
  for (const format of publishedFormats(recipe.formats)) {
    const still = await frameStill(base, format, recipe.layout);
    const boxes: FractionRect[] = [];
    for (const d of drawn) {
      if (refused.has(d.words.index)) continue;
      for (const language of LANGUAGES) {
        const o = await renderOverlay({ format, language, base: still, brief, kit, logo, layout: recipe.layout, look: recipe.look, ...drawnCopy(slots, d.words.copy[language]) });
        if (o.kind === "refused") { refused.set(d.words.index, { format, language, findings: o.findings }); break; }
        d.images.push({ format, language, png: o.png });
        boxes.push(toFraction(o.stack, format));
      }
    }
    if (refused.size === drawn.length) {
      // No words can be drawn on this picture: the refusal named is the best-ranked words', as it always was.
      const first = refused.get(drawn[0]!.words.index)!;
      return { kind: "stop", reason: `render check (${first.format}, ${first.language}): ${overlaySummary(first.findings)}`, checks: { render: { ok: false, format: first.format, language: first.language, findings: first.findings } }, answer };
    }
    const v = await checkVisual(deps, {
      ...ids, format, attempt, picture,
      subject: { image: { format: "png", bytes: new Uint8Array(still) }, reference, scene: recipe, kit, text_band: union(boxes) },
    });
    if (v.kind === "in_flight") return { kind: "pending", why: `visual ${format} ${attempt} in flight`, answer };
    if (v.kind === "no_reference") return { kind: "stop", reason: "visual: the scene shows equipment and no reference photo was chosen", answer };
    if (v.kind !== "passed" && v.kind !== "check_failed") return { kind: "stop", reason: `visual: ${stopCode(v)}`, answer };
    visual[format] = v.results;
    for (const r of v.results) if (r.verdict === "fail") failed.add(r.check);
  }
  if (failed.size > 0) return { kind: "visual_failed", answer, visual, failed: [...failed] };
  return {
    kind: "passed", answer, visual, subject: art.direction.composition.focal_subject,
    drawn: drawn.filter((d) => !refused.has(d.words.index)),
    undrawable: [...refused].map(([index, r]) => ({ index, reason: `${r.format}, ${r.language}: ${overlaySummary(r.findings)}`.slice(0, 300) })),
    logo: kit.logo && logo ? { format: kit.logo.format, bytes: new Uint8Array(logo) } : null,
  };
}

/**
 * The words the overlay draws, by role, from one language's copy: the headline and the call to action always,
 * and the two small lines when the preset names a slot for them (D-ADL4). One function for the fit asked before
 * the picture and the render after it, so the two are asked about the same words.
 */
export function drawnCopy(slots: NonNullable<AdPresetRecipe["overlay_slots"]>, copy: Record<string, string>): { headline: string; cta: string; kicker: string | null; subline: string | null } {
  const said = Object.fromEntries(overlaySlotList(slots).map(([role, slot]) => [role, copy[slot] ?? null]));
  return { headline: said.headline!, cta: said.cta!, kicker: said.kicker ?? null, subline: said.subline ?? null };
}

function toFraction(box: { x: number; y: number; width: number; height: number }, format: AdFormat): FractionRect {
  const { width: W, height: H } = FORMAT_SIZE[format];
  return { x: box.x / W, y: box.y / H, width: box.width / W, height: box.height / H };
}

/** The smallest rectangle holding every box — the band the text of any language and any words covers. */
export function union(boxes: FractionRect[]): FractionRect {
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)));
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)));
  const right = Math.min(1, Math.max(...boxes.map((b) => b.x + b.width)));
  const bottom = Math.min(1, Math.max(...boxes.map((b) => b.y + b.height)));
  return { x, y, width: right - x, height: bottom - y };
}

export const overlaySummary = (fs: OverlayFinding[]) => [...new Set(fs.map((f) => f.kind))].join(", ");
export function stopCode(o: { kind: string; errorCode?: string; refusal?: string }): string {
  return o.kind === "failed" ? o.errorCode ?? "failed" : o.kind === "budget_exhausted" ? `budget_exhausted (${o.refusal})` : o.kind;
}
