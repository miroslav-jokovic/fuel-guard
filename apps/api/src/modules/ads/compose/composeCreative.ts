import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_PICTURES_PER_CREATIVE, adMotionSchema, adPairingsSchema, publishedFormats, rankCandidates,
  type AdAssetRef, type AdBrandKit, type AdMotion, type AdBrief, type AdCandidates, type AdFormat, type AdPairings, type AdPresetRecipe, type ArtAnswer, type CreativeState, type WriterAngle,
} from "@silvicom/shared";
import type { RenderInput, RenderOutcome } from "../creative/higgsfield/render.js";
import { overlayFit, type OverlayFinding, type OverlayLanguage } from "../creative/overlay/overlay.js";
import { writeCopy, type AdCopy, type SlotFinding } from "../workers/copywriter/copywriter.js";
import { CRAFT_JUDGE_PROMPT_VERSION, judgeCraft } from "../workers/craftJudge/craftJudge.js";
import { judgeFinishedAds } from "../workers/finishedAdJudge/finishedAdJudge.js";
import { rankPictures } from "./creativePairings.js";
import { drawnCopy, makePicture, overlaySummary, stopCode, type DrawnImage, type PictureDeps, type PictureOutcome, type WordsToDraw } from "./creativePictures.js";

export { drawnCopy, union } from "./creativePictures.js";

import { makeMotion, type MotionDeps } from "./creativeMotion.js";
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
 * Since V3 (ADS-PLATFORM-V2-PLAN "make many, show few") the art → render → check part is one PICTURE's
 * (`creativePictures.ts`), a creative may make several, and which picture under which words becomes the ad is
 * ranked (`creativePairings.ts`); see `fromPictures` below. Everything in this comment about one picture holds for
 * each of them.
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
 * ── A PLANNED CAMPAIGN'S CREATIVE IS WRITTEN AND DRAWN FROM ITS ANGLE (V2c) ───────────────────────────
 * `input.angle` is the idea of the approved plan's angle this preset was drawn for (`writerAngle`, found by the
 * campaign's compose step). The Copywriter is handed the idea and its proof, the Art director the idea; nothing
 * else here reads it. It adds no fact: the copy check and the art check are asked exactly as without it. A
 * person's own words (Q-ADL7) are not rewritten from it, and the picture they keep is replayed, not redrawn.
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

export interface ComposeDeps extends PictureDeps {
  render: (input: RenderInput) => Promise<RenderOutcome>;
  /** Higgsfield's model path for stills. Null until V4 chooses and prices one: compose stops, visibly. */
  renderModel: string | null;
  readAsset: (orgId: string, ref: Pick<AdAssetRef, "sha256" | "format">) => Promise<Buffer>;
  storeAsset: (orgId: string, bytes: Buffer) => Promise<AdAssetRef>;
  /** What a motion ad needs beyond a still's (V4): absent, no creative is ever set moving. */
  motion?: Pick<MotionDeps, "videoModel" | "readClip" | "storeClip" | "ffmpeg">;
}

export interface ComposeInput {
  creative: CreativeRow;
  brief: AdBrief;
  recipe: AdPresetRecipe;
  kit: AdBrandKit;
  maxRegenerations: number;
  /** `settings.budgets.candidates_per_creative` (CQ4); absent = the Copywriter's default. */
  candidates?: number;
  /** `settings.budgets.pictures_per_creative` (V3, Q-APX7); absent = 1, the one picture every creative had before V3. */
  pictures?: number;
  /** The approved plan's idea for this preset (V2c); null or absent for a campaign that was not planned. */
  angle?: WriterAngle | null;
  /** The approved plan's angle for this preset is a motion ad (`angleFormat`, V4): the finished still is also set moving. */
  motion?: boolean;
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
  /** `picture`: which of the replaced creative's pictures is kept (V3); absent = its first, the only one before V3. */
  replaced: { creativeId: string; attempt: number; picture?: number; candidates: AdCandidates | null };
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
    return fromPictures(deps, input, [{ index: candidates?.chosen ?? 0, offeredAs: ch.from_candidate !== null && set ? set.ranked[ch.from_candidate]?.offered_as ?? 0 : 0, copy: ch.copy }], candidates, stop);
  }

  const written = await writeCopy(deps, { ...ids, attempt: 1, brief, recipe, company_name: input.kit.company_name, candidates: input.candidates, angle: input.angle ?? null });
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
  // One picture: the first words that fit, as before V3. Several: every set that fits, each paired with each picture.
  const fitting: WordsToDraw[] = ranked.flatMap((r, index) => (unfit[index] === null ? [{ index, offeredAs: r.offered_as, copy: r.copy }] : []));
  return fromPictures(deps, input, pictureCount(input) === 1 ? fitting.slice(0, 1) : fitting, candidates, stop);
}

/**
 * The pictures, the pairing that becomes the ad, and `ready` — or why not. One function for the words the ranking
 * chose and the words a person chose (Q-ADL7).
 *
 * ── ONE PICTURE IS THE AD AS IT ALWAYS WAS; SEVERAL ARE RANKED (V3, Q-APX7) ───────────────────────────
 * `input.pictures` is `settings.budgets.pictures_per_creative`. At 1 — and for a person's choice, which keeps the
 * picture it was made on — nothing differs from before V3: one picture under the first words that fit, the same
 * ledger keys, no `pairings` written. Above 1 each picture is made in turn (`makePicture`), every one that passes is
 * paired with the words it can carry, the finished-ad judge ranks the pairings (`rankPictures`), the first becomes
 * the ad, and the rest are kept beside it as one image each (Q-APX9). A picture that cannot be used is dropped with
 * its reason; the creative stops only when none can.
 *
 * Every picture is directed and its render queued before this returns `pending`, so three renders wait in the
 * queue together and not one after another across three runs of the step.
 */
async function fromPictures(deps: ComposeDeps, input: ComposeInput, words: WordsToDraw[], candidates: AdCandidates | null, stop: (s: Stop) => Promise<ComposeOutcome>): Promise<ComposeOutcome> {
  const { creative: cr, brief, recipe, kit } = input;
  const ids = { orgId: cr.org_id, campaignId: cr.campaign_id, creativeId: cr.id };
  const reuse = input.choice ? { creativeId: input.choice.replaced.creativeId, picture: input.choice.replaced.picture ?? 1, attempt: input.choice.replaced.attempt } : undefined;
  const n = pictureCount(input);
  const made: PictureOutcome[] = [];
  const earlier: ArtAnswer[] = [];
  for (let picture = 1; picture <= n; picture += 1) {
    const r = await makePicture(deps, {
      ids, brief, recipe, kit, maxRegenerations: input.maxRegenerations, idea: input.angle?.idea ?? null, picture, earlier: [...earlier], words,
      ...(reuse ? { reuse } : {}), onRendered: () => markChecking(deps.admin, cr),
    });
    made.push(r);
    // A picture whose direction is not known yet cannot be told to the next one: wait, and come back.
    if (r.kind === "pending" && !r.answer) break;
    if (r.answer) earlier.push(r.answer);
  }
  const waiting = made.find((m) => m.kind === "pending");
  if (waiting?.kind === "pending") return { kind: "pending", why: waiting.why };

  const passed = made.flatMap((m, i) => (m.kind === "passed" ? [{ ...m, picture: i + 1 }] : []));
  if (passed.length === 0) {
    const dropped = made.flatMap((m) => (m.kind === "dropped" ? [m] : []));
    // The same reason for every picture (a switched-off agent, no still model) is said once, as it was for one.
    const same = new Set(dropped.map((d) => d.reason)).size === 1;
    const reason = same ? dropped[0]!.reason : `none of the ${n} pictures could be used — ${dropped.map((d, i) => `#${i + 1} (${d.reason})`).join(" · ")}`;
    return stop({ kind: "stop", reason: reason.slice(0, 2000), checks: { copy: { ok: true }, ...dropped[0]!.checks } });
  }
  const slots = recipe.overlay_slots!;
  const store = async (images: DrawnImage[]): Promise<CreativeAsset[]> => {
    const assets: CreativeAsset[] = [];
    for (const r of images) {
      const ref = await deps.storeAsset(cr.org_id, r.png);
      assets.push({ format: r.format, language: r.language, sha256: ref.sha256, path: `${cr.org_id}/${ref.sha256}.png`, width: ref.width, height: ref.height });
    }
    return assets;
  };
  const checksOf = (p: (typeof passed)[number], finishedAd: unknown) => ({ copy: { ok: true }, render: { ok: true }, visual: { ok: true, attempt: p.attempt, results: p.visual }, visual_attempts: p.history, finished_ad: finishedAd });

  if (n === 1) {
    const pic = passed[0]!, drawn = pic.drawn[0]!;
    const assets = await store(drawn.images);
    // P1-7 (Q-AD76): a second opinion on the finished ad, never a gate — switched off or refused, it says so and
    // the creative still reaches review.
    const opinion = await judgeFinishedAds(deps, {
      ...ids, attempt: pic.attempt, ads: drawn.images.filter((i) => i.language === "en").map((i) => ({ format: i.format, png: i.png })), kit, logo: pic.logo, subject: pic.subject,
      headline: drawn.words.copy.en[slots.headline]!, button: drawn.words.copy.en[slots.cta]!,
    });
    if (opinion.kind === "pending") return { kind: "pending", why: opinion.why };
    const moving = await motionOf(deps, input, { picture: 1, attempt: pic.attempt, base: pic.base }, drawn.words.copy);
    if (moving.kind === "pending") return moving;
    await finish(deps.admin, cr, { state: "ready", copy: drawn.words.copy, candidates, assets, regenerations: pic.attempt - 1, last_error: null, checks: { ...checksOf(pic, opinion.check), ...moving.checks }, ...moving.patch });
    return { kind: "ready" };
  }

  const out = await rankPictures(deps, { ids, recipe, kit, pictures: passed });
  if (out.kind === "pending") return out;
  const winner = out.ranked[0]!;
  const assets = await store(winner.drawn.images);
  const ranked: AdPairings["ranked"] = [];
  for (const r of out.ranked) {
    const ref = await deps.storeAsset(cr.org_id, r.png);
    ranked.push({ picture: r.picture, words: r.words, judged: r.judged, total: r.total, preview: { sha256: ref.sha256, path: `${cr.org_id}/${ref.sha256}.png`, width: ref.width, height: ref.height } });
  }
  // Parsed at the write: a body the review screen could not read is a bug here, not a blank screen there.
  const pairings = adPairingsSchema.parse({
    format: out.format, ranked, chosen: 0, judge: out.judge,
    pictures: made.map((m, i) => ({
      picture: i + 1, attempt: m.kind === "pending" ? 1 : m.attempt, reference: m.answer?.reference_photo ?? null,
      focal_subject: m.answer?.focal_subject ?? null, camera_distance: m.answer?.camera_distance ?? null,
      dropped: m.kind === "dropped" ? m.reason.slice(0, 300) : null,
      ...(m.kind === "passed" && m.undrawable.length > 0 ? { undrawable: m.undrawable.map((u) => ({ words: u.index, reason: u.reason })) } : {}),
    })),
  } satisfies AdPairings);
  const won = passed.find((p) => p.picture === winner.picture)!;
  const moving = await motionOf(deps, input, { picture: winner.picture, attempt: won.attempt, base: won.base }, winner.drawn.words.copy);
  if (moving.kind === "pending") return moving;
  await finish(deps.admin, cr, {
    // The words that became `copy` are the winning pairing's, which need not be the craft judge's first.
    state: "ready", copy: winner.drawn.words.copy, candidates: candidates ? { ...candidates, chosen: winner.words } : null, pairings, assets,
    regenerations: winner.from.attempt - 1, last_error: null, checks: { ...checksOf(won, out.finishedAd), ...moving.checks }, ...moving.patch,
  });
  return { kind: "ready" };
}

/**
 * The creative's motion ad, when its plan angle asks for one (V4; `creativeMotion.ts`) — made from the picture and
 * the words that just became the ad, after every check of the still has passed.
 *
 * ── A MOTION AD THAT CANNOT BE MADE DOES NOT TAKE THE STILL WITH IT (ours, 2026-11-17) ────────────
 * The still is a whole ad: checked, judged, the last frame the video would have ended on. So the creative goes to
 * review as that still, and `checks.motion` says why there is no video — never a silent downgrade, and never a
 * finished, paid-for picture thrown away because a clip came back short. A person who wanted the video sees the
 * reason beside the ad and can regenerate. The other reading — no video, no creative — is one line here.
 *
 * Not asked for a person's choice (Q-ADL7): that creative keeps the replaced one's picture and is keyed anew, so
 * its clip would be bought a second time for the same picture. Carrying the clip across is its own step.
 */
async function motionOf(
  deps: ComposeDeps, input: ComposeInput, pic: { picture: number; attempt: number; base: Pick<AdAssetRef, "sha256" | "format"> }, copy: AdCopy,
): Promise<{ kind: "pending"; why: string } | { kind: "settled"; checks: { motion?: Record<string, unknown> }; patch: { motion?: AdMotion } }> {
  if (!input.motion || input.choice || !deps.motion) return { kind: "settled", checks: {}, patch: {} };
  const { creative: cr } = input;
  const out = await makeMotion({ ...deps.motion, render: deps.render, readAsset: deps.readAsset }, {
    ids: { orgId: cr.org_id, campaignId: cr.campaign_id, creativeId: cr.id }, attempt: pic.attempt, picture: pic.picture, base: pic.base,
    brief: input.brief, recipe: input.recipe, kit: input.kit, copy,
  });
  if (out.kind === "pending") return out;
  if (out.kind === "stop") return { kind: "settled", checks: { motion: { ...(out.checks ?? { ok: false }), reason: out.reason } }, patch: {} };
  // Parsed at the write, as `pairings` is: a body the review screen could not read is a bug here.
  return { kind: "settled", checks: { motion: out.checks }, patch: { motion: adMotionSchema.parse(out.motion) } };
}

/** How many pictures this creative is chosen from: the setting, 1 for a person's choice (it keeps its picture) and when unset. */
export function pictureCount(input: Pick<ComposeInput, "pictures" | "choice">): number {
  return input.choice ? 1 : Math.min(MAX_PICTURES_PER_CREATIVE, Math.max(1, Math.trunc(input.pictures ?? 1)));
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

const summarise = (fs: SlotFinding[]) => [...new Set(fs.map((f) => `${f.kind} (${f.language} ${f.slot})`))].join(", ");

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
