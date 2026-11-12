import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FORMAT_SIZE, overlaySlotList, publishedFormats, rankCandidates, withRegenerationClauses,
  type AdAssetRef, type AdBrandKit, type AdBrief, type AdCandidates, type AdFormat, type AdPresetRecipe, type AdVisualCheck, type CreativeState,
} from "@silvicom/shared";
import type { ClaudeGenerationDeps } from "../generations/claudeGeneration.js";
import { stillParams } from "../creative/higgsfield/prices.js";
import type { RenderInput, RenderOutcome } from "../creative/higgsfield/render.js";
import { frameStill, overlayFit, renderOverlay, type OverlayFinding, type OverlayLanguage } from "../creative/overlay/overlay.js";
import { writeCopy, type AdCopy, type SlotFinding } from "../workers/copywriter/copywriter.js";
import { CRAFT_JUDGE_PROMPT_VERSION, judgeCraft } from "../workers/craftJudge/craftJudge.js";
import { directArt } from "../workers/artDirector/artDirector.js";
import { checkVisual, type FractionRect, type VisionImage, type VisualResult } from "../workers/checker/checker.js";
import { judgeFinishedAds } from "../workers/finishedAdJudge/finishedAdJudge.js";

/**
 * One creative, moved as far as it can go (ADS-AGENT-BUILD-WORKFLOW C5b; plan D-AD9, D-AD12). Called by
 * the campaign's compose step (C5b2) as often as it takes; every run is safe to repeat, because every
 * model and vendor call below is keyed and replayed from its ledger row — a re-run asks nobody twice.
 *
 *   copy (attempt 1: k candidates, each checked; the craft judge ranks the survivors; the first becomes the copy —
 *   CQ4, D-AD19/D-AD21; the whole ranked set is stored in `candidates`, 0579) → for attempt a = 1 … 1 + max_regenerations:
 *     art (a; from a 2nd attempt on, our fixed clause per check that failed) → render (a; still drawing =
 *     `pending`) → per format: the still framed, the overlay in English and Spanish (the render check),
 *     the visual check over the framed still with the band the overlay actually covered
 *   → `ready` with everything a person must see, or `check_failed` with the reason.
 *
 * ── ONLY THE FORMATS AN AD IS SHOWN IN (Q-AD75, ruled 2026-11-10; D-AD25) ─────────────────────────────
 * "Per format" above means per PUBLISHED format: `publishedFormats(recipe.formats)`, the list the publisher
 * itself picks from. Until this ruling every format of the preset was framed, overlaid and checked, and a
 * failed check on any of them failed the creative — so a 9:16 centre crop that cut the truck in half, an
 * image no placement can show until Q-AD29, sent a good feed ad back for a regeneration that shrank its
 * subject (audit F-AG3). A preset with no published format stops FIRST, before the copywriter is asked:
 * the save refuses one today (AG2), and one saved before that would otherwise be paid for and then refused
 * at publish. The picture is asked for in the FIRST published frame's shape (`stillParams`, AG4) — the one
 * the art director composed for — and a shorter frame is cut from it keeping the edge the words sit against
 * (`frameStill`), so the words of every format lie over the part of the picture that was kept plain.
 *
 * ── WHAT IS REGENERATED, AND WHAT STOPS ────────────────────────────────────────────────────────────
 * D-AD12 regenerates on a VISUAL failure only ("A fail regenerates once with the failure added to the
 * prompt, then stops"): a new image can fix lettering or a truck in the band. A copy refusal (a claim
 * outside the brief) or an overlay refusal (a headline needing a third line) is not the image's fault,
 * so it stops at once. So does anything a person must answer — the budget, a switched-off agent, a
 * preset that does not say which slots the overlay draws. A stopped creative is `check_failed` with the
 * reason in `last_error`: 0537 has no other end state for "the workers stopped", and leaving it in
 * `generating` would show work under way that is not.
 *
 * ── THE COPY THAT SHIPS IS THE BEST-RANKED ONE THE OVERLAY CAN DRAW (AG1, D-AD26) ──────────────────────
 * Until 2026-11-10 `ranked[0]` became the ad whatever happened next, and when the overlay then refused it (a
 * headline needing a third line) the creative stopped with two drawable candidates unused (audit F-AG6). Whether
 * words fit is a fact about the words, the format and the layout — no picture changes it — so it is asked
 * BEFORE the render, of each candidate in rank order, on every published format in both languages
 * (`overlayFit`, the overlay's own layout step). The first that fits is the copy; `candidates.chosen` names it
 * and `passed_over` says why each better-ranked one was not used. Only when none fits does the creative stop,
 * and it has then cost no picture. Contrast is the picture's and is still judged at the overlay.
 *
 * ── THE RENDER STARTS FROM THE PHOTO THE CHECK COMPARES AGAINST (D-AD9, 2026-11-04) ─────────────────
 * The Art director's `reference` is one kit photo; the render is image-to-image from it (`render.ts`
 * uploads it once and names it in the model's image field) and the visual check compares the result with
 * the same photo. That the photo is in this kit is the Art director's check (`reference_not_in_kit`), not
 * repeated here.
 */

export interface CreativeRow {
  id: string;
  org_id: string;
  campaign_id: string;
  state: CreativeState;
  regenerations: number;
}

export interface ComposeDeps extends ClaudeGenerationDeps {
  render: (input: RenderInput) => Promise<RenderOutcome>;
  /** Higgsfield's model path for stills. Null until V4 chooses and prices one: compose stops, visibly. */
  renderModel: string | null;
  readAsset: (orgId: string, ref: Pick<AdAssetRef, "sha256" | "format">) => Promise<Buffer>;
  storeAsset: (orgId: string, bytes: Buffer) => Promise<AdAssetRef>;
}

export interface ComposeInput {
  creative: CreativeRow;
  brief: AdBrief;
  recipe: AdPresetRecipe;
  kit: AdBrandKit;
  maxRegenerations: number;
  /** `settings.budgets.candidates_per_creative` (CQ4); absent = the Copywriter's default. */
  candidates?: number;
  /** A person chose this creative's words (Q-ADL7): no copywriter, no judge, and the replaced creative's picture. */
  choice?: PersonChoice;
}

/**
 * The words a person settled on for the creative this one replaces (`ads_copy_choices`, 0595), and that creative's
 * ranked set and last attempt. The door already checked the words against the brief and the overlay; the overlay
 * and the visual check run again here on the finished picture, as for any creative.
 */
export interface PersonChoice {
  copy: AdCopy;
  from_candidate: number | null;
  edited_slots: string[];
  chosen_by_name: string;
  replaced: { creativeId: string; attempt: number; candidates: AdCandidates | null };
}

export interface CreativeAsset { format: AdFormat; language: OverlayLanguage; sha256: string; path: string; width: number; height: number }

export type ComposeOutcome =
  | { kind: "pending"; why: string }
  | { kind: "ready" }
  | { kind: "check_failed"; reason: string }
  /** The creative had already left the workers: nothing done. */
  | { kind: "done"; state: CreativeState };

const LANGUAGES: OverlayLanguage[] = ["en", "es"];
type Stop = { kind: "stop"; reason: string; checks?: Record<string, unknown> };
type Pending = { kind: "pending"; why: string };

export async function composeCreative(deps: ComposeDeps, input: ComposeInput): Promise<ComposeOutcome> {
  const { creative: cr, brief, recipe } = input;
  if (cr.state !== "generating" && cr.state !== "checking") return { kind: "done", state: cr.state };
  const ids = { orgId: cr.org_id, campaignId: cr.campaign_id, creativeId: cr.id };
  const stop = (s: Stop) => finish(deps.admin, cr, { state: "check_failed", last_error: s.reason, checks: s.checks ?? null }).then(() => ({ kind: "check_failed" as const, reason: s.reason }));

  if (!recipe.overlay_slots) return stop({ kind: "stop", reason: "no_overlay_slots: the preset does not say which copy slots the overlay draws" });
  if (publishedFormats(recipe.formats).length === 0) return stop({ kind: "stop", reason: `no_feed_format: the preset's formats (${recipe.formats.join(", ")}) hold none an ad is shown in` });

  if (input.choice) {
    // The person's words: the ranked set is the replaced creative's, pointing at the copy they started from.
    const ch = input.choice, set = ch.replaced.candidates;
    const candidates = set ? { ...set, chosen: ch.from_candidate ?? set.chosen, chosen_by_person: { name: ch.chosen_by_name, edited_slots: ch.edited_slots } } : null;
    if (candidates) await keep(deps.admin, cr, { candidates });
    return attempts(deps, input, ch.copy, candidates, stop);
  }

  const written = await writeCopy(deps, { ...ids, attempt: 1, brief, recipe, company_name: input.kit.company_name, candidates: input.candidates });
  if (written.kind === "in_flight") return { kind: "pending", why: "copy in flight" };
  if (written.kind === "refused") return stop({ kind: "stop", reason: `copy check: ${summarise(written.findings)}`, checks: { copy: { ok: false, findings: written.findings, by_candidate: written.byCandidate } } });
  if (written.kind !== "ready") return stop({ kind: "stop", reason: `copy: ${stopCode(written)}` });

  // The craft judge ranks the survivors (D-AD21). Switched off, out of budget or failing, it ranks nothing: the order
  // is then the Copywriter's own and the set says so (`judge: null`) — what every creative was before CQ4, recorded.
  const judged = written.passed.length > 1
    ? await judgeCraft(deps, { ...ids, attempt: 1, brief, recipe, candidates: written.passed.map((p) => p.copy), company_name: input.kit.company_name })
    : null;
  if (judged?.kind === "in_flight") return { kind: "pending", why: "craft judge in flight" };
  const scores = judged?.kind === "ready" ? judged.scores : null;
  const ranked = rankCandidates(written.passed.map((p, i) => ({ copy: p.copy, judged: scores ? scores[i]! : null, offered_as: p.offered_as })));
  // The first ranked candidate the overlay can draw (D-AD26). `unfit[i]` is why candidate i cannot be.
  const unfit = ranked.map((r) => fitRefusal(input, r.copy));
  const fits = unfit.findIndex((u) => u === null);
  // A kit with no overlay for the format refuses every copy alike: that is the kit's, and no candidate was "passed over".
  const kitHasNoTemplate = unfit[0]?.findings.some((f) => f.kind === "no_template") ?? false;
  const passedOver = kitHasNoTemplate ? [] : unfit.slice(0, fits < 0 ? unfit.length : fits).map((u, index) => ({ index, reason: `${u!.format}, ${u!.language}: ${overlaySummary(u!.findings)}`.slice(0, 300) }));
  const candidates: AdCandidates = {
    ranked: ranked.map((r) => ({ copy: r.copy, judged: r.judged, total: r.total, offered_as: r.offered_as })),
    chosen: Math.max(fits, 0), judge: scores ? CRAFT_JUDGE_PROMPT_VERSION : null, offered: written.offered, passed: written.passed.length,
    ...(passedOver.length > 0 ? { passed_over: passedOver } : {}),
  };
  // The set is written as soon as it exists, so a creative that stops later (a render, a visual check) still shows
  // what was written and how it was ranked; `finish` carries it again on the final row.
  await keep(deps.admin, cr, { candidates });
  if (fits < 0) {
    // What is on the row is the best-ranked candidate's refusal; the reason names every candidate's.
    const first = unfit[0]!;
    const reason = ranked.length === 1 || kitHasNoTemplate ? `render check (${first.format}, ${first.language}): ${overlaySummary(first.findings)}`
      : `render check: none of the ${ranked.length} copies fits the image — ${passedOver.map((p) => `#${p.index + 1} (${p.reason})`).join(" · ")}`;
    return stop({ kind: "stop", reason: reason.slice(0, 2000), checks: { copy: { ok: true }, render: { ok: false, format: first.format, language: first.language, findings: first.findings } } });
  }
  return attempts(deps, input, ranked[fits]!.copy, candidates, stop);
}

/**
 * Art, render, overlay and visual check, regenerating on a visual failure (D-AD12), then the finished-ad opinion and
 * `ready`. One function for the copy the ranking chose and the copy a person chose (Q-ADL7).
 */
async function attempts(deps: ComposeDeps, input: ComposeInput, copy: AdCopy, candidates: AdCandidates | null, stop: (s: Stop) => Promise<ComposeOutcome>): Promise<ComposeOutcome> {
  const { creative: cr, recipe } = input;
  const ids = { orgId: cr.org_id, campaignId: cr.campaign_id, creativeId: cr.id };
  let failed: AdVisualCheck[] = [];
  const history: Array<{ attempt: number; visual: Record<string, VisualResult[]> }> = [];
  for (let attempt = 1; attempt <= 1 + input.maxRegenerations; attempt += 1) {
    const r = await oneAttempt(deps, input, copy, attempt, failed);
    if (r.kind === "pending") return r;
    if (r.kind === "stop") return stop({ ...r, checks: { copy: { ok: true }, ...r.checks, visual_attempts: history } });
    history.push({ attempt, visual: r.visual });
    if (r.kind === "passed") {
      // P1-7 (Q-AD76): a second opinion on the finished ad, never a gate — switched off or refused, it says so and
      // the creative still reaches review.
      const opinion = await judgeFinishedAds(deps, {
        ...ids, attempt, ads: r.english, kit: input.kit, logo: r.logo, subject: r.subject,
        headline: copy.en[recipe.overlay_slots!.headline]!, button: copy.en[recipe.overlay_slots!.cta]!,
      });
      if (opinion.kind === "pending") return { kind: "pending", why: opinion.why };
      await finish(deps.admin, cr, {
        state: "ready", copy, candidates, assets: r.assets, regenerations: attempt - 1, last_error: null,
        checks: { copy: { ok: true }, render: { ok: true }, visual: { ok: true, attempt, results: r.visual }, visual_attempts: history, finished_ad: opinion.check },
      });
      return { kind: "ready" };
    }
    failed = r.failed;
  }
  const reasons = history.at(-1)!.visual;
  const said = Object.entries(reasons).flatMap(([format, rs]) => rs.filter((x) => x.verdict === "fail").map((x) => `${format} ${x.check}: ${x.reason}`));
  return stop({ kind: "stop", reason: `visual check failed after ${history.length} attempt(s): ${said.join(" · ")}`.slice(0, 2000), checks: { copy: { ok: true }, render: { ok: true }, visual: { ok: false }, visual_attempts: history } });
}

type AttemptResult =
  | Pending
  | Stop
  | { kind: "passed"; visual: Record<string, VisualResult[]>; assets: CreativeAsset[]; english: Array<{ format: AdFormat; png: Buffer }>; logo: VisionImage | null; subject: string }
  | { kind: "visual_failed"; visual: Record<string, VisualResult[]>; failed: AdVisualCheck[] };

async function oneAttempt(deps: ComposeDeps, input: ComposeInput, copy: AdCopy, attempt: number, failedBefore: AdVisualCheck[]): Promise<AttemptResult> {
  const { creative: cr, brief, recipe, kit } = input;
  const ids = { orgId: cr.org_id, campaignId: cr.campaign_id, creativeId: cr.id };
  // A person's choice keeps the replaced creative's picture: its art and render rows are replayed by their keys, so
  // nothing is asked again and nothing is paid twice (Q-ADL7). A regeneration after a failed check is a new picture.
  const reused = attempt === 1 && input.choice ? input.choice.replaced : null;
  const from = reused ? { ...ids, creativeId: reused.creativeId } : ids, fromAttempt = reused ? reused.attempt : attempt;
  const art = await directArt(deps, { ...from, attempt: fromAttempt, recipe, kit, context: brief.subject_matter.details, headline: copy.en[recipe.overlay_slots!.headline] ?? null });
  if (art.kind === "in_flight") return { kind: "pending", why: `art ${attempt} in flight` };
  if (art.kind === "not_possible") return { kind: "stop", reason: `art: ${art.reason}` };
  if (art.kind === "refused") return { kind: "stop", reason: `art check: ${art.findings.map((f) => f.kind).join(", ")}` };
  if (art.kind !== "ready") return { kind: "stop", reason: `art: ${stopCode(art)}` };

  if (!deps.renderModel) return { kind: "stop", reason: "render: no still model chosen yet (V4)" };
  const prompt = withRegenerationClauses(art.direction.prompt, failedBefore);
  const ref = art.direction.reference;
  const render = await deps.render({ ...from, attempt: fromAttempt, model: deps.renderModel, params: stillParams(deps.renderModel, prompt, art.direction.composition.frame), reference: ref ? { sha256: ref.sha256, format: ref.format } : null });
  if (render.kind === "pending") return { kind: "pending", why: `render ${attempt}: ${render.why}` };
  if (render.kind === "refused") return { kind: "stop", reason: `render: ${render.refusal}` };
  if (render.kind !== "stored") return { kind: "stop", reason: `render: ${render.kind === "failed" ? render.errorCode : render.refusal}` };
  if (render.assets.length === 0) return { kind: "stop", reason: "render: no image" };
  await markChecking(deps.admin, cr);

  const base = await deps.readAsset(cr.org_id, render.assets[0]!);
  const logo = kit.logo ? await deps.readAsset(cr.org_id, kit.logo) : null;
  const photo = ref ? kit.equipment_photos.find((p) => p.asset.sha256 === ref.sha256) ?? null : null;
  const reference = photo ? { label: photo.label, image: { format: photo.asset.format, bytes: new Uint8Array(await deps.readAsset(cr.org_id, photo.asset)) } } : null;

  const visual: Record<string, VisualResult[]> = {};
  const failed = new Set<AdVisualCheck>();
  const rendered: Array<{ format: AdFormat; language: OverlayLanguage; png: Buffer }> = [];
  for (const format of publishedFormats(recipe.formats)) {
    const still = await frameStill(base, format, recipe.layout);
    const boxes: FractionRect[] = [];
    for (const language of LANGUAGES) {
      const o = await renderOverlay({
        format, language, base: still, brief, kit, logo, layout: recipe.layout, look: recipe.look,
        ...drawnCopy(recipe.overlay_slots!, copy[language]),
      });
      if (o.kind === "refused") return { kind: "stop", reason: `render check (${format}, ${language}): ${overlaySummary(o.findings)}`, checks: { render: { ok: false, format, language, findings: o.findings } } };
      rendered.push({ format, language, png: o.png });
      boxes.push(toFraction(o.stack, format));
    }
    const v = await checkVisual(deps, {
      ...ids, format, attempt,
      subject: { image: { format: "png", bytes: new Uint8Array(still) }, reference, scene: recipe, kit, text_band: union(boxes) },
    });
    if (v.kind === "in_flight") return { kind: "pending", why: `visual ${format} ${attempt} in flight` };
    if (v.kind === "no_reference") return { kind: "stop", reason: "visual: the scene shows equipment and no reference photo was chosen" };
    if (v.kind !== "passed" && v.kind !== "check_failed") return { kind: "stop", reason: `visual: ${stopCode(v)}` };
    visual[format] = v.results;
    for (const r of v.results) if (r.verdict === "fail") failed.add(r.check);
  }
  if (failed.size > 0) return { kind: "visual_failed", visual, failed: [...failed] };

  const assets: CreativeAsset[] = [];
  for (const r of rendered) {
    const ref = await deps.storeAsset(cr.org_id, r.png);
    assets.push({ format: r.format, language: r.language, sha256: ref.sha256, path: `${cr.org_id}/${ref.sha256}.png`, width: ref.width, height: ref.height });
  }
  const english = rendered.filter((r) => r.language === "en").map((r) => ({ format: r.format, png: r.png }));
  return { kind: "passed", visual, assets, english, logo: kit.logo && logo ? { format: kit.logo.format, bytes: new Uint8Array(logo) } : null, subject: art.direction.composition.focal_subject };
}

/**
 * Why the overlay cannot draw this copy — the first published format and language that refuses it, with the
 * overlay's own findings — or null when it can draw it everywhere it will be asked to.
 */
function fitRefusal(input: ComposeInput, copy: AdCopy): { format: AdFormat; language: OverlayLanguage; findings: OverlayFinding[] } | null {
  const { brief, recipe, kit } = input;
  for (const format of publishedFormats(recipe.formats)) {
    for (const language of LANGUAGES) {
      const findings = overlayFit({ format, language, brief, kit, layout: recipe.layout, look: recipe.look, ...drawnCopy(recipe.overlay_slots!, copy[language]) });
      if (findings.length > 0) return { format, language, findings };
    }
  }
  return null;
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

/** The smallest rectangle holding every box — the band the text of either language covers. */
export function union(boxes: FractionRect[]): FractionRect {
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)));
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)));
  const right = Math.min(1, Math.max(...boxes.map((b) => b.x + b.width)));
  const bottom = Math.min(1, Math.max(...boxes.map((b) => b.y + b.height)));
  return { x, y, width: right - x, height: bottom - y };
}

const summarise = (fs: SlotFinding[]) => [...new Set(fs.map((f) => `${f.kind} (${f.language} ${f.slot})`))].join(", ");
const overlaySummary = (fs: OverlayFinding[]) => [...new Set(fs.map((f) => f.kind))].join(", ");
function stopCode(o: { kind: string; errorCode?: string; refusal?: string }): string {
  return o.kind === "failed" ? o.errorCode ?? "failed" : o.kind === "budget_exhausted" ? `budget_exhausted (${o.refusal})` : o.kind;
}

/** A field written while the workers still hold the creative (`generating`/`checking`); a creative that left both is not touched. */
async function keep(admin: SupabaseClient, cr: CreativeRow, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("ads_creatives").update(patch).eq("org_id", cr.org_id).eq("id", cr.id).in("state", ["generating", "checking"]);
  if (error) throw new Error(`ads_creatives ${cr.id}: ${error.message}`);
}

/** `generating` → `checking` once the image exists. A creative that already left both states is not touched. */
async function markChecking(admin: SupabaseClient, cr: CreativeRow): Promise<void> {
  const { error } = await admin.from("ads_creatives").update({ state: "checking" }).eq("org_id", cr.org_id).eq("id", cr.id).eq("state", "generating");
  if (error) throw new Error(`ads_creatives ${cr.id}: ${error.message}`);
}

/** The one write that ends the workers' part. Guarded by state, so a re-run after it is a no-op (AX030 freezes it). */
async function finish(admin: SupabaseClient, cr: CreativeRow, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("ads_creatives").update(patch).eq("org_id", cr.org_id).eq("id", cr.id).in("state", ["generating", "checking"]);
  if (error) throw new Error(`ads_creatives ${cr.id}: ${error.message}`);
}
