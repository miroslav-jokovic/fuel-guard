import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FORMAT_SIZE, withRegenerationClauses,
  type AdAssetRef, type AdBrandKit, type AdBrief, type AdFormat, type AdPresetRecipe, type AdVisualCheck, type CreativeState,
} from "@silvicom/shared";
import type { ClaudeGenerationDeps } from "../generations/claudeGeneration.js";
import type { RenderInput, RenderOutcome } from "../creative/higgsfield/render.js";
import { frameStill, renderOverlay, type OverlayFinding, type OverlayLanguage } from "../creative/overlay/overlay.js";
import { writeCopy, type AdCopy, type SlotFinding } from "../workers/copywriter/copywriter.js";
import { directArt } from "../workers/artDirector/artDirector.js";
import { checkVisual, type FractionRect, type VisualResult } from "../workers/checker/checker.js";

/**
 * One creative, moved as far as it can go (ADS-AGENT-BUILD-WORKFLOW C5b; plan D-AD9, D-AD12). Called by
 * the campaign's compose step (C5b2) as often as it takes; every run is safe to repeat, because every
 * model and vendor call below is keyed and replayed from its ledger row — a re-run asks nobody twice.
 *
 *   copy (attempt 1) → for attempt a = 1 … 1 + max_regenerations:
 *     art (a; from a 2nd attempt on, our fixed clause per check that failed) → render (a; still drawing =
 *     `pending`) → per format: the still framed, the overlay in English and Spanish (the render check),
 *     the visual check over the framed still with the band the overlay actually covered
 *   → `ready` with everything a person must see, or `check_failed` with the reason.
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
 * ⚠ NOT BUILT, said so: the render does not yet START from the kit photo (D-AD9 image-to-image) — the
 * Higgsfield upload docs are unread (C3 log). The visual check still compares against that photo.
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
  /** Higgsfield's model path for stills; refused `price_unknown` by the credit gate until V4 prices it. */
  renderModel: string;
  readAsset: (orgId: string, ref: Pick<AdAssetRef, "sha256" | "format">) => Promise<Buffer>;
  storeAsset: (orgId: string, bytes: Buffer) => Promise<AdAssetRef>;
}

export interface ComposeInput {
  creative: CreativeRow;
  brief: AdBrief;
  recipe: AdPresetRecipe;
  kit: AdBrandKit;
  maxRegenerations: number;
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

  const copy = await writeCopy(deps, { ...ids, attempt: 1, brief, recipe });
  if (copy.kind === "in_flight") return { kind: "pending", why: "copy in flight" };
  if (copy.kind === "refused") return stop({ kind: "stop", reason: `copy check: ${summarise(copy.findings)}`, checks: { copy: { ok: false, findings: copy.findings } } });
  if (copy.kind !== "ready") return stop({ kind: "stop", reason: `copy: ${stopCode(copy)}` });

  let failed: AdVisualCheck[] = [];
  const history: Array<{ attempt: number; visual: Record<string, VisualResult[]> }> = [];
  for (let attempt = 1; attempt <= 1 + input.maxRegenerations; attempt += 1) {
    const r = await oneAttempt(deps, input, copy.copy, attempt, failed);
    if (r.kind === "pending") return r;
    if (r.kind === "stop") return stop({ ...r, checks: { copy: { ok: true }, ...r.checks, visual_attempts: history } });
    history.push({ attempt, visual: r.visual });
    if (r.kind === "passed") {
      await finish(deps.admin, cr, {
        state: "ready", copy: copy.copy, assets: r.assets, regenerations: attempt - 1, last_error: null,
        checks: { copy: { ok: true }, render: { ok: true }, visual: { ok: true, attempt, results: r.visual }, visual_attempts: history },
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
  | { kind: "passed"; visual: Record<string, VisualResult[]>; assets: CreativeAsset[] }
  | { kind: "visual_failed"; visual: Record<string, VisualResult[]>; failed: AdVisualCheck[] };

async function oneAttempt(deps: ComposeDeps, input: ComposeInput, copy: AdCopy, attempt: number, failedBefore: AdVisualCheck[]): Promise<AttemptResult> {
  const { creative: cr, brief, recipe, kit } = input;
  const ids = { orgId: cr.org_id, campaignId: cr.campaign_id, creativeId: cr.id };
  const art = await directArt(deps, { ...ids, attempt, recipe, kit });
  if (art.kind === "in_flight") return { kind: "pending", why: `art ${attempt} in flight` };
  if (art.kind === "not_possible") return { kind: "stop", reason: `art: ${art.reason}` };
  if (art.kind === "refused") return { kind: "stop", reason: `art check: ${art.findings.map((f) => f.kind).join(", ")}` };
  if (art.kind !== "ready") return { kind: "stop", reason: `art: ${stopCode(art)}` };

  const prompt = withRegenerationClauses(art.direction.prompt, failedBefore);
  const render = await deps.render({ ...ids, attempt, model: deps.renderModel, params: { prompt } });
  if (render.kind === "pending") return { kind: "pending", why: `render ${attempt}: ${render.why}` };
  if (render.kind === "refused") return { kind: "stop", reason: `render: ${render.refusal}` };
  if (render.kind !== "stored") return { kind: "stop", reason: `render: ${render.kind === "failed" ? render.errorCode : render.refusal}` };
  if (render.assets.length === 0) return { kind: "stop", reason: "render: no image" };
  await markChecking(deps.admin, cr);

  const base = await deps.readAsset(cr.org_id, render.assets[0]!);
  const logo = kit.logo ? await deps.readAsset(cr.org_id, kit.logo) : null;
  const photo = art.direction.reference ? kit.equipment_photos.find((p) => p.asset.sha256 === art.direction.reference!.sha256) ?? null : null;
  const reference = photo ? { label: photo.label, image: { format: photo.asset.format, bytes: new Uint8Array(await deps.readAsset(cr.org_id, photo.asset)) } } : null;

  const visual: Record<string, VisualResult[]> = {};
  const failed = new Set<AdVisualCheck>();
  const rendered: Array<{ format: AdFormat; language: OverlayLanguage; png: Buffer }> = [];
  for (const format of recipe.formats) {
    const still = await frameStill(base, format);
    const boxes: FractionRect[] = [];
    for (const language of LANGUAGES) {
      const o = await renderOverlay({
        format, language, base: still, brief, kit, logo,
        headline: copy[language][recipe.overlay_slots!.headline]!, cta: copy[language][recipe.overlay_slots!.cta]!,
      });
      if (o.kind === "refused") return { kind: "stop", reason: `render check (${format}, ${language}): ${overlaySummary(o.findings)}`, checks: { render: { ok: false, format, language, findings: o.findings } } };
      rendered.push({ format, language, png: o.png });
      boxes.push(...o.blocks.map((b) => toFraction(b.box, format)));
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
  return { kind: "passed", visual, assets };
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
