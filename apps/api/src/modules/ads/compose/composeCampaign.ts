import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adBriefSchema, drawPresets, nextPresetBatch, type AdPresetRecipe, type CreativeState, type PresetDraw } from "@silvicom/shared";
import { listBrandKits, listPresets } from "../creative/kitVersions.js";
import { settingsInForce } from "../settings/settingsVersions.js";
import { storePresetDraw, type CampaignRow } from "../orchestrator/transitions.js";
import type { WorkerResult } from "../orchestrator/workers.js";
import { composeCreative, type ComposeDeps, type CreativeRow } from "./composeCreative.js";

/**
 * The campaign's compose step (ADS-AGENT-BUILD-WORKFLOW C5b2; plan D-AD11, D-AD12): what the orchestrator's
 * `compose` worker does in `composing`. Each run, idempotently:
 *
 *   1. THE DRAW (D-AD11). The first run draws the presets — seed = the campaign id, every enabled preset
 *      eligible except those a campaign for the same brief runs now — and stores the whole draw in
 *      `ads_campaigns.preset_draw` (written only while it is null, so a re-run keeps the first draw).
 *   2. THE BATCH. The first `BATCH` presets of the draw (plan v4: "new creatives enter two at a time").
 *   3. A CREATIVE PER PRESET IN THIS STINT. A preset's creative is its newest row. A new row's id is
 *      derived from campaign + preset + stint (`state_changed_at`), so two runs racing to insert it make
 *      one row (23505 = the other run won), and "made in this stint" is a fact about the id, not a
 *      comparison of the database's clock with ours. A newest row that ended badly (`check_failed`,
 *      `rejected`) in an EARLIER stint — a person pressed Resume or Regenerate — is superseded by this
 *      stint's row (`supersedes_id`); anything else is kept, so a re-run never redoes finished work.
 *   4. EACH CREATIVE MOVED (`composeCreative`). Any still under way → `pending`, the campaign stays.
 *   5. THE VERDICT. At least one `ready` → `creatives_ready` (review shows every creative, failed ones with
 *      their reasons). None → `compose_failed`, the reasons joined, for a person to read.
 *
 * Stops before any creative, as `compose_failed` with the reason: the campaign names no brand kit, or one that
 * is archived or has no saved version (Q-AD28: the kit is the campaign's `brand_kit_id`, chosen at creation —
 * never "the only one" or "the newest", which would be a second rule beside the column), or a draw with
 * nothing eligible. Each creative is made with the kit's NEWEST version and records it, so correcting a phone
 * number in the kit reaches the next creative without a new campaign.
 */

/** How many concepts enter at once (plan v4, §2b.2). */
export const BATCH = 2;
const REDO: CreativeState[] = ["check_failed", "rejected"];

export interface ComposeCampaignDeps extends ComposeDeps {
  admin: SupabaseClient;
}

interface CampaignExtra { brief_ref: string; brief_snapshot: unknown; preset_draw: PresetDraw | null; brand_kit_id: string | null }
interface CreativeRead extends CreativeRow { preset_version_id: string; created_at: string; last_error: string | null }

export async function composeCampaign(deps: ComposeCampaignDeps, c: CampaignRow): Promise<WorkerResult> {
  const { admin } = deps;
  const { data: extra, error } = await admin.from("ads_campaigns").select("brief_ref, brief_snapshot, preset_draw, brand_kit_id").eq("org_id", c.org_id).eq("id", c.id).maybeSingle();
  if (error) throw new Error(`ads_campaigns ${c.id}: ${error.message}`);
  if (!extra) return { ok: false, error: "campaign not found" };
  const campaign = extra as CampaignExtra;
  const brief = adBriefSchema.safeParse(campaign.brief_snapshot);
  if (!brief.success) return { ok: false, error: "the campaign's brief does not parse" };

  if (!campaign.brand_kit_id) return { ok: false, error: "the campaign names no brand kit (Q-AD28)" };
  const chosen = (await listBrandKits(admin, c.org_id)).find((k) => k.id === campaign.brand_kit_id);
  if (!chosen) return { ok: false, error: "the campaign's brand kit no longer exists" };
  if (chosen.archived_at) return { ok: false, error: "the campaign's brand kit is archived" };
  if (!chosen.current) return { ok: false, error: "the campaign's brand kit has no saved version (Q-AD14)" };
  const kit = chosen.current;

  const presets = (await listPresets(admin, c.org_id)).filter((p) => !p.archived_at && p.current);
  const draw = campaign.preset_draw ?? await storePresetDraw(admin, c, drawPresets(c.id, presets.map((p) => ({ version_id: p.current!.id, key: p.key, enabled: p.current!.enabled })), await liveKeys(admin, c, campaign.brief_ref, presets)));
  if (draw.exhausted) return { ok: false, error: "no preset to draw: every enabled preset already runs for this brief, or none is enabled" };
  const recipes = new Map(presets.map((p) => [p.current!.id, p.current!.body]));
  // A drawn version that is no longer the preset's newest is still the one drawn: read it by id.
  for (const id of draw.order) if (!recipes.has(id)) recipes.set(id, await recipeById(admin, c.org_id, id));

  const { settings } = await settingsInForce(admin, c.org_id);
  const rows = await creatives(admin, c);
  const reasons: string[] = [];
  let ready = 0;
  for (const presetId of nextPresetBatch(draw, [], BATCH)) {
    const creative = await creativeForStint(admin, c, presetId, kit.id, rows);
    const out = await composeCreative(deps, { creative, brief: brief.data, recipe: recipes.get(presetId)!, kit: kit.body, maxRegenerations: settings.budgets.max_regenerations });
    if (out.kind === "pending") return { ok: false, pending: true, why: `creative ${creative.id}: ${out.why}` };
    const state = out.kind === "done" ? out.state : out.kind === "ready" ? "ready" : "check_failed";
    if (state === "ready" || state === "approved") ready += 1;
    else reasons.push(out.kind === "check_failed" ? out.reason : creative.last_error ?? state);
  }
  return ready > 0 ? { ok: true } : { ok: false, error: `no creative passed its checks: ${reasons.join(" | ")}`.slice(0, 2000) };
}

/** The preset keys a campaign for the same brief runs now (launching, live) — excluded from the draw. */
async function liveKeys(admin: SupabaseClient, c: CampaignRow, briefRef: string, presets: Array<{ id: string; key: string }>): Promise<string[]> {
  const { data: others, error } = await admin.from("ads_campaigns").select("id").eq("org_id", c.org_id).eq("brief_ref", briefRef).in("state", ["launching", "live"]).neq("id", c.id);
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  const ids = (others ?? []).map((o) => (o as { id: string }).id);
  if (ids.length === 0) return [];
  const { data: crs, error: e2 } = await admin.from("ads_creatives").select("preset_version_id").eq("org_id", c.org_id).in("campaign_id", ids).in("state", ["approved", "live"]);
  if (e2) throw new Error(`ads_creatives: ${e2.message}`);
  const versions = [...new Set((crs ?? []).map((r) => (r as { preset_version_id: string }).preset_version_id))];
  if (versions.length === 0) return [];
  const { data: vs, error: e3 } = await admin.from("ad_concept_preset_versions").select("id, preset_id").eq("org_id", c.org_id).in("id", versions);
  if (e3) throw new Error(`ad_concept_preset_versions: ${e3.message}`);
  const keyOf = new Map(presets.map((p) => [p.id, p.key]));
  return [...new Set((vs ?? []).map((v) => keyOf.get((v as { preset_id: string }).preset_id)).filter((k): k is string => !!k))];
}

async function recipeById(admin: SupabaseClient, orgId: string, id: string): Promise<AdPresetRecipe> {
  const { data, error } = await admin.from("ad_concept_preset_versions").select("recipe").eq("org_id", orgId).eq("id", id).single();
  if (error) throw new Error(`ad_concept_preset_versions ${id}: ${error.message}`);
  return (data as { recipe: AdPresetRecipe }).recipe;
}

async function creatives(admin: SupabaseClient, c: CampaignRow): Promise<CreativeRead[]> {
  const { data, error } = await admin.from("ads_creatives").select("id, org_id, campaign_id, preset_version_id, state, regenerations, created_at, last_error").eq("org_id", c.org_id).eq("campaign_id", c.id).order("created_at", { ascending: true });
  if (error) throw new Error(`ads_creatives: ${error.message}`);
  return (data ?? []) as CreativeRead[];
}

/** A uuid made from what makes the row unique, so a racing insert collides instead of duplicating. */
export function stintCreativeId(campaignId: string, presetVersionId: string, stint: string): string {
  const h = createHash("sha256").update(`${campaignId}:${presetVersionId}:${stint}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function creativeForStint(admin: SupabaseClient, c: CampaignRow, presetId: string, kitVersionId: string, rows: CreativeRead[]): Promise<CreativeRead> {
  const id = stintCreativeId(c.id, presetId, c.state_changed_at);
  const newest = rows.filter((r) => r.preset_version_id === presetId).at(-1);
  // This stint's own row (by id, not by comparing the database's clock with ours), or one that did not end badly.
  if (newest && (newest.id === id || !REDO.includes(newest.state))) return newest;
  const row = {
    id, org_id: c.org_id, campaign_id: c.id, preset_version_id: presetId,
    brand_kit_version_id: kitVersionId, supersedes_id: newest?.id ?? null, state: "generating" as const,
  };
  const { data, error } = await admin.from("ads_creatives").insert(row).select("id, org_id, campaign_id, preset_version_id, state, regenerations, created_at, last_error").single();
  if (!error) return data as CreativeRead;
  if ((error as { code?: string }).code !== "23505") throw new Error(`ads_creatives: ${error.message}`);
  const { data: won, error: e2 } = await admin.from("ads_creatives").select("id, org_id, campaign_id, preset_version_id, state, regenerations, created_at, last_error").eq("org_id", c.org_id).eq("id", row.id).single();
  if (e2) throw new Error(`ads_creatives: ${e2.message}`);
  return won as CreativeRead;
}

