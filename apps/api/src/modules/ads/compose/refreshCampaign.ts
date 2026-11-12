import type { SupabaseClient } from "@supabase/supabase-js";
import { adBriefSchema, nextRefreshOption, refreshOptions, type AdPlatform, type CreativeState } from "@silvicom/shared";
import { completeAction, startAction } from "../actions/actionLedger.js";
import { sendAdsAlert } from "../alerts/adsAlerts.js";
import { listPresets } from "../creative/kitVersions.js";
import { addCampaignAds, type CampaignRow } from "../orchestrator/transitions.js";
import type { WorkerResult } from "../orchestrator/workers.js";
import type { PlatformAdapter } from "../platforms/adapter.js";
import type { ReplacementOutcome } from "../platforms/meta/publishCampaign.js";
import { settingsInForce } from "../settings/settingsVersions.js";
import { campaignKit, liveKeys, recipeById, stintCreativeId } from "./composeCampaign.js";
import type { ComposeInput, ComposeOutcome } from "./composeCreative.js";

/**
 * A retired ad's replacement on a LIVE campaign (ADS-CREATIVE-QUALITY-PLAN Q-AD68, ruled 2026-11-11; D-AD23). What the
 * orchestrator's `refresh` worker does each tick a live campaign is stepped, after the kill switch was checked.
 * Idempotent: every answer is read from rows, so a re-run finds the last run's work.
 *
 * For every creative the monitor retired (`platform_status = retired`, CQ9b), oldest first, its replacements — the
 * creatives that name it in `supersedes_id` — decide the one thing to do:
 *   · one is ACTIVE on the platform                        → nothing: it was replaced.
 *   · one is still being made (`generating`, `checking`)   → move it (`composeCreative`); ready → the bell asks a person.
 *   · one is `ready`                                       → nothing: a person's turn (the review screen, live campaign).
 *   · one is `approved` and not yet on the platform        → publish it into the existing ad set, PAUSED; add its ads to
 *                                                            the campaign's refs; turn each ACTIVE (`activate_ad`).
 *   · none, or every one ended badly (`check_failed`, `rejected`) → the next attempt, from `refreshOptions`' order, while
 *                                                            fewer than `REFRESH_ATTEMPTS` were made; else the bell
 *                                                            says none could be made, once.
 *
 * ── WHY ACTIVATION IS NOT BEHIND THE SPEND GUARD ─────────────────────────────────────────────────
 * Turning an ad on inside an ad set changes neither the ad set's daily budget nor the campaign's cap, which an approved
 * launch set and which bound what Meta can spend. Its fences: the runner's kill-switch check before this runs; the
 * creative's own `approve_creative` row, cited on every `activate_ad` row; and the database, which refuses an
 * `activate_ad` without that approval or while the kill switch is on (0587, AX020/AX021).
 */

/**
 * The step's three effects outside our rows, handed in (`orchestrator/workers.ts` binds the real ones): make one
 * creative (`composeCreative`), publish one approved creative into the campaign's ad set (`publishReplacement`), and
 * the connection's adapter. The decisions here are tested against the ads world with each effect faked; the effects
 * have their own tests against FakeMeta and the compose harness.
 */
export interface RefreshDeps {
  admin: SupabaseClient;
  now: () => Date;
  composeOne: (input: ComposeInput) => Promise<ComposeOutcome>;
  publishOne: (c: CampaignRow, creativeId: string) => Promise<ReplacementOutcome>;
  platform: (orgId: string, connectionId: string) => Promise<{ platform: AdPlatform; adapter: PlatformAdapter } | null>;
}

const IN_FLIGHT: CreativeState[] = ["generating", "checking"];
const ENDED_BADLY: CreativeState[] = ["check_failed", "rejected"];
/** An ad that will not turn on after this many tries stops being asked, and a person is told. */
const ACTIVATE_TRIES = 3;
const ORCHESTRATOR = "Ads orchestrator";
/**
 * Publish refusals said before any platform call, or about what the platform already holds: asking again changes
 * nothing. Anything else (a throttle, a token, a timeout) is retried on the next step.
 */
const FINAL_PUBLISH_REFUSALS = new Set(["creative_not_approved", "no_platform_slots", "creative_copy_missing", "no_feed_image", "not_on_platform", "adopted_existing_ad"]);

interface Row {
  id: string; org_id: string; campaign_id: string; preset_version_id: string; state: CreativeState; regenerations: number;
  platform_status: string | null; supersedes_id: string | null; created_at: string;
}

export async function refreshCampaign(deps: RefreshDeps, c: CampaignRow): Promise<WorkerResult> {
  const { admin } = deps;
  const rows = await creatives(admin, c);
  const retired = rows.filter((r) => r.platform_status === "retired");
  if (retired.length === 0) return { ok: true };

  const pending: string[] = [];
  const failures: string[] = [];
  for (const old of retired) {
    const reps = rows.filter((r) => r.supersedes_id === old.id);
    if (reps.some((r) => r.platform_status === "active")) continue;

    const inFlight = reps.find((r) => IN_FLIGHT.includes(r.state));
    if (inFlight) { const why = await make(deps, c, inFlight); if (why) pending.push(why); continue; }
    if (reps.some((r) => r.state === "ready")) continue;
    const approved = reps.find((r) => r.state === "approved" && r.platform_status === null);
    if (approved) { const why = await turnOn(deps, c, approved); if (why) failures.push(why); continue; }

    // Nothing under way: the next attempt, if there may be one.
    const next = await nextAttempt(deps, c, old, reps, rows);
    if (!next.ok) { await sayNoneMade(admin, c, old, next.why); continue; }
    const why = await make(deps, c, next.row);
    if (why) pending.push(why);
  }
  if (failures.length > 0) return { ok: false, error: failures.join(" | ").slice(0, 2000) };
  return pending.length > 0 ? { ok: false, pending: true, why: pending.join(" | ") } : { ok: true };
}

/** Move one replacement through the workers; the bell rings the one time it reaches `ready`. Returns why it waits. */
async function make(deps: RefreshDeps, c: CampaignRow, creative: Row): Promise<string | null> {
  const { admin } = deps;
  const material = await campaignMaterial(admin, c);
  if (!material.ok) return `creative ${creative.id}: ${material.error}`;
  const { settings } = await settingsInForce(admin, c.org_id);
  const out = await deps.composeOne({
    creative, brief: material.brief, recipe: await recipeById(admin, c.org_id, creative.preset_version_id), kit: material.kit.body,
    maxRegenerations: settings.budgets.max_regenerations, candidates: settings.budgets.candidates_per_creative,
  });
  if (out.kind === "pending") return `creative ${creative.id}: ${out.why}`;
  if (out.kind === "ready") {
    await sendAdsAlert(admin, c.org_id, {
      category: "ads_creative_refresh", severity: "info", entityType: "ads_creative", entityId: creative.id,
      title: "A new ad awaits your approval",
      body: "An ad on a running campaign was retired because it had tired. Its replacement is ready: approve it and it is turned on in the same campaign, with the same budget.",
      dedupeKey: `ads_creative_refresh:ready:${creative.id}`,
    });
  }
  return null;
}

async function campaignMaterial(admin: SupabaseClient, c: CampaignRow) {
  const { data, error } = await admin.from("ads_campaigns").select("brief_ref, brief_snapshot, brand_kit_id").eq("org_id", c.org_id).eq("id", c.id).single();
  if (error) throw new Error(`ads_campaigns ${c.id}: ${error.message}`);
  const row = data as { brief_ref: string; brief_snapshot: unknown; brand_kit_id: string | null };
  const brief = adBriefSchema.safeParse(row.brief_snapshot);
  if (!brief.success) return { ok: false as const, error: "the campaign's brief does not parse" };
  const kit = await campaignKit(admin, c.org_id, row.brand_kit_id);
  if (!kit.ok) return kit;
  return { ok: true as const, brief: brief.data, kit: kit.kit, brief_ref: row.brief_ref };
}

/** The next attempt's creative row, made once (its id is derived, so a racing run collides), or why there is none. */
async function nextAttempt(deps: RefreshDeps, c: CampaignRow, old: Row, reps: Row[], rows: Row[]): Promise<{ ok: true; row: Row } | { ok: false; why: string }> {
  const { admin } = deps;
  const material = await campaignMaterial(admin, c);
  if (!material.ok) return { ok: false, why: material.error };
  const presets = (await listPresets(admin, c.org_id)).filter((p) => !p.archived_at && p.current);
  const keyOfVersion = await versionKeys(admin, c.org_id, rows.map((r) => r.preset_version_id), presets);
  const retiredKey = keyOfVersion.get(old.preset_version_id);
  if (!retiredKey) return { ok: false, why: "the retired ad's preset no longer exists" };
  const options = refreshOptions({
    campaign_id: c.id, retired_creative_id: old.id,
    presets: presets.map((p) => ({ version_id: p.current!.id, key: p.key, enabled: p.current!.enabled })),
    approved_keys: rows.filter((r) => r.state === "approved" || r.state === "live").map((r) => keyOfVersion.get(r.preset_version_id)).filter((k): k is string => !!k),
    live_keys_for_brief: await liveKeys(admin, c, material.brief_ref, presets.map((p) => ({ id: p.id, key: p.key }))),
    retired_key: retiredKey,
  });
  // Only replacements that ended badly reach here, so every one is a spent attempt.
  const next = nextRefreshOption(options, reps.filter((r) => ENDED_BADLY.includes(r.state)).map((r) => r.preset_version_id));
  if (!next.ok) return { ok: false, why: next.why };
  const row = {
    id: stintCreativeId(c.id, next.option.version_id, `refresh:${old.id}:${reps.length}`),
    org_id: c.org_id, campaign_id: c.id, preset_version_id: next.option.version_id,
    brand_kit_version_id: material.kit.id, supersedes_id: old.id, state: "generating" as const,
  };
  const cols = "id, org_id, campaign_id, preset_version_id, state, regenerations, platform_status, supersedes_id, created_at";
  const { data, error } = await admin.from("ads_creatives").insert(row).select(cols).single();
  if (!error) return { ok: true, row: data as Row };
  if ((error as { code?: string }).code !== "23505") throw new Error(`ads_creatives: ${error.message}`);
  const { data: won, error: e2 } = await admin.from("ads_creatives").select(cols).eq("org_id", c.org_id).eq("id", row.id).single();
  if (e2) throw new Error(`ads_creatives: ${e2.message}`);
  return { ok: true, row: won as Row };
}

/** Preset key per version id: the creatives' versions may be older than each preset's current one. */
async function versionKeys(admin: SupabaseClient, orgId: string, versionIds: string[], presets: Array<{ id: string; key: string }>): Promise<Map<string, string>> {
  const ids = [...new Set(versionIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await admin.from("ad_concept_preset_versions").select("id, preset_id").eq("org_id", orgId).in("id", ids);
  if (error) throw new Error(`ad_concept_preset_versions: ${error.message}`);
  const keyOf = new Map(presets.map((p) => [p.id, p.key]));
  return new Map(((data ?? []) as Array<{ id: string; preset_id: string }>).flatMap((v) => (keyOf.has(v.preset_id) ? [[v.id, keyOf.get(v.preset_id)!] as [string, string]] : [])));
}

/**
 * The approved replacement onto the platform and on: its ads made PAUSED in the existing ad set, added to the refs,
 * then each turned ACTIVE with its own ledger row citing the person's approval. Returns why it did not finish, or null.
 */
async function turnOn(deps: RefreshDeps, c: CampaignRow, creative: Row): Promise<string | null> {
  const { admin } = deps;
  const now = () => deps.now().toISOString();
  const approval = await standingApproval(admin, c, creative.id);
  if (!approval) return `creative ${creative.id}: approved without a standing approval row`;

  const published = await deps.publishOne(c, creative.id);
  if (!published.ok) {
    // A refusal that no retry can change is final: marked, told once, never asked again every minute.
    if (FINAL_PUBLISH_REFUSALS.has(published.error_code)) {
      await markPlatformStatus(admin, c, creative.id, "publish_failed", now());
      await sendAdsAlert(admin, c.org_id, {
        category: "ads_creative_refresh", severity: "warning", entityType: "ads_creative", entityId: creative.id,
        title: "An approved ad could not be published",
        body: `The approved replacement could not be put on the platform (${published.error_code}). The campaign keeps running without it; nothing more is tried.`,
        dedupeKey: `ads_creative_refresh:publish_failed:${creative.id}`,
      });
    }
    return `creative ${creative.id}: publish ${published.error_code}`;
  }
  const refs = await addCampaignAds(admin, c, published.ads);
  if (!refs) return null; // the campaign left `live` meanwhile: nothing is turned on; a relaunch is a person's.

  const found = await deps.platform(c.org_id, c.connection_id);
  if (!found) return `creative ${creative.id}: no usable platform connection`;
  const ref = { campaign_id: c.id, platform: found.platform, platform_refs: refs };
  for (const ad of published.ads) {
    const tries = await activations(admin, c, creative.id, ad.meta_ad_id);
    if (tries.some((t) => t.status === "succeeded")) continue;
    if (tries.filter((t) => t.status === "failed").length >= ACTIVATE_TRIES) {
      await markPlatformStatus(admin, c, creative.id, "activate_failed", now());
      await sendAdsAlert(admin, c.org_id, {
        category: "ads_creative_refresh", severity: "warning", entityType: "ads_creative", entityId: creative.id,
        title: "An approved ad could not be turned on",
        body: `The platform refused to turn on the ${ad.language.toUpperCase()} ad ${ACTIVATE_TRIES} times. The campaign keeps running without it; nothing more is tried.`,
        dedupeKey: `ads_creative_refresh:activate_failed:${creative.id}`,
      });
      return `creative ${creative.id}: activation refused ${ACTIVATE_TRIES} times`;
    }
    const key = `activate_ad:${c.id}:${ad.meta_ad_id}:${tries.length}`;
    const started = await startAction(admin, {
      org_id: c.org_id, campaign_id: c.id, creative_id: creative.id, connection_id: c.connection_id, kind: "activate_ad",
      actor_kind: "agent", actor_id: null, actor_name: ORCHESTRATOR, approval_id: approval, idempotency_key: key,
      cause: "a retired ad's approved replacement (Q-AD68)", request: { ad: ad.meta_ad_id, language: ad.language },
    }, now());
    if (started === "duplicate") return `creative ${creative.id}: activation ${key} already under way`;
    if (!("id" in started)) return `creative ${creative.id}: activation refused by the database (${started.refusedBy})`;
    const out = await found.adapter.safe.activateAd({ campaign: ref, ad: ad.meta_ad_id, idempotency_key: key });
    await completeAction(admin, c.org_id, started.id, { status: out.ok ? "succeeded" : "failed", response: out.response ?? null, error_code: out.ok ? null : out.error_code, at: now() });
    if (!out.ok) return `creative ${creative.id}: activation ${out.error_code}`;
  }
  await markPlatformStatus(admin, c, creative.id, "active", now());
  return null;
}

/** The person's standing `approve_creative` for this creative: the newest one nobody withdrew. */
async function standingApproval(admin: SupabaseClient, c: CampaignRow, creativeId: string): Promise<string | null> {
  const { data, error } = await admin.from("ads_approvals").select("id").eq("org_id", c.org_id).eq("campaign_id", c.id)
    .eq("creative_id", creativeId).eq("kind", "approve_creative").order("created_at", { ascending: false });
  if (error) throw new Error(`ads_approvals: ${error.message}`);
  for (const a of (data ?? []) as Array<{ id: string }>) {
    const { data: w, error: wErr } = await admin.from("ads_approvals").select("id").eq("org_id", c.org_id).eq("kind", "withdraw").eq("withdraws_id", a.id).limit(1);
    if (wErr) throw new Error(`ads_approvals: ${wErr.message}`);
    if ((w ?? []).length === 0) return a.id;
  }
  return null;
}

async function activations(admin: SupabaseClient, c: CampaignRow, creativeId: string, adId: string): Promise<Array<{ status: string }>> {
  const { data, error } = await admin.from("ads_actions").select("status").eq("org_id", c.org_id).eq("campaign_id", c.id)
    .eq("creative_id", creativeId).eq("kind", "activate_ad").eq("request->>ad", adId);
  if (error) throw new Error(`ads_actions: ${error.message}`);
  return (data ?? []) as Array<{ status: string }>;
}

/** `platform_status` says what the platform does with a creative (CQ9b's column): `active`, or `activate_failed`. */
async function markPlatformStatus(admin: SupabaseClient, c: CampaignRow, creativeId: string, status: string, at: string): Promise<void> {
  const { error } = await admin.from("ads_creatives").update({ platform_status: status, updated_at: at }).eq("org_id", c.org_id).eq("id", creativeId);
  if (error) throw new Error(`ads_creatives ${creativeId}: ${error.message}`);
}

/** The bell, once per retired ad, when no replacement can be made. */
async function sayNoneMade(admin: SupabaseClient, c: CampaignRow, old: Row, why: string): Promise<void> {
  const words = why === "attempts_spent" ? "two replacements were made and neither was approved or passed its checks" : why === "nothing_to_enter" ? "no enabled preset can enter" : why;
  await sendAdsAlert(admin, c.org_id, {
    category: "ads_creative_refresh", severity: "warning", entityType: "ads_creative", entityId: old.id,
    title: "No replacement for a retired ad",
    body: `An ad on a running campaign was retired and ${words}. The campaign keeps running with its other ads; enabling another preset, or a new campaign, brings in a new concept.`,
    dedupeKey: `ads_creative_refresh:none:${old.id}`,
  });
}

async function creatives(admin: SupabaseClient, c: CampaignRow): Promise<Row[]> {
  const { data, error } = await admin.from("ads_creatives").select("id, org_id, campaign_id, preset_version_id, state, regenerations, platform_status, supersedes_id, created_at")
    .eq("org_id", c.org_id).eq("campaign_id", c.id).order("created_at", { ascending: true });
  if (error) throw new Error(`ads_creatives: ${error.message}`);
  return (data ?? []) as Row[];
}

