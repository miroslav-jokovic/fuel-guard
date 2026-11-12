import type { SupabaseClient } from "@supabase/supabase-js";
import { AD_NAME_LANGUAGES, adBriefSchema, adPresetRecipeSchema, type AdNameLanguage } from "@silvicom/shared";
import type { Env } from "../../../../env.js";
import type { PlatformOutcome } from "../adapter.js";
import { graphForConnection, pageGraphForConnection, type ConnectionForGraph, type RegistryDeps } from "../registry.js";
import type { CampaignRow } from "../../orchestrator/transitions.js";
import { publishPaused, type PublishInput, type PublisherDeps } from "./publisher.js";
import { creativeRefusal, publishAds, type PublishCreative, type PublishedAd } from "./publisherAds.js";

/**
 * The orchestrator's `createPaused` (ADS-AGENT-BUILD-WORKFLOW B2c2): everything `publishPaused` needs,
 * read from our rows, then the publisher. Every read is org-scoped — the service role bypasses RLS.
 *
 *   · the campaign's brief (`brief_snapshot`: the area, the form questions), its name parts and amounts;
 *   · its connection: the ad account and Page, and both Graph clients from the registry. A connection that
 *     is missing, another org's, disconnected, or cannot be opened answers `no_platform` — the runner's
 *     word for it on every other step, and one `alerts/connectionAlerts.ts` tells an admin about;
 *   · its APPROVED creatives only (D-AD12: a person approved each), with their preset's key and
 *     `platform_slots`, read from the preset VERSION the creative was made with.
 *
 * The privacy page is the web host's `/privacy` (`WEB_APP_URL`); a host that is not https is refused by
 * the publisher's preflight, so a laptop's `http://localhost` never reaches Meta.
 */

export interface PublishCampaignDeps extends RegistryDeps {
  admin: SupabaseClient;
  env: Env;
  now: () => Date;
  readAsset: PublisherDeps["readAsset"];
}

interface CampaignExtra { brief_source: string; brief_ref: string; brief_snapshot: unknown; created_at: string }
type ConnectionRow = ConnectionForGraph & { page_token_sealed: string | null; account_ref: string | null; page_ref: string | null; status: string };

export async function publishCampaign(deps: PublishCampaignDeps, c: CampaignRow, key: string): Promise<PlatformOutcome> {
  const ctx = await publishContext(deps, c, await approvedCreatives(deps.admin, c), key);
  return ctx.ok ? publishPaused(ctx.publisher, ctx.input) : ctx;
}

export type ReplacementOutcome = { ok: true; ads: PublishedAd[] } | { ok: false; error_code: string; response?: unknown };

/**
 * A retired ad's approved replacement published into the campaign's EXISTING ad set (Q-AD68): its ads, one per
 * language, PAUSED, made exactly as `publishPaused` makes every ad (`publishAds`: find by our name, adopt one, create
 * none, refuse two). The ad set and the forms are the campaign's own, read from its refs; nothing above the ad level is
 * created or changed. The ledger key is the creative's own (`<campaign>:refresh:<creative>`), so a retried step finds
 * its rows, and the creative's short id is in every name, so a fresh execution of the retired ad's own preset makes
 * new ads instead of adopting the retired ones. Turning them ACTIVE is the caller's (`compose/refreshCampaign.ts`).
 */
export async function publishReplacement(deps: PublishCampaignDeps, c: CampaignRow, creativeId: string): Promise<ReplacementOutcome> {
  const creative = (await approvedCreatives(deps.admin, c)).find((x) => x.id === creativeId);
  if (!creative) return { ok: false, error_code: "creative_not_approved" };
  const refused = creativeRefusal(creative);
  if (refused) return { ok: false, error_code: refused };
  const refs = c.platform_refs ?? {};
  const adsetId = typeof refs.meta_adset_id === "string" ? refs.meta_adset_id : null;
  const forms = (refs.meta_form_ids ?? {}) as Partial<Record<AdNameLanguage, unknown>>;
  if (!adsetId || AD_NAME_LANGUAGES.some((l) => typeof forms[l] !== "string")) return { ok: false, error_code: "not_on_platform" };
  const ctx = await publishContext(deps, c, [creative], `${c.id}:refresh:${creativeId}`);
  if (!ctx.ok) return ctx;
  const out = await publishAds(ctx.publisher, ctx.input, { adsetId, forms: forms as Record<AdNameLanguage, string> });
  // ⚠ A name carries only the creative's first eight hex characters (`shortId`). Two creatives that share them name
  // their ads alike, and `publishAds` ADOPTS an ad it finds by name — so the replacement would come back holding the
  // RETIRED ad, and turning it on would bring the tired ad back under a new approval. Found by this file's own test
  // ("refuses an ad the campaign already holds") with two fixture ids alike in their first eight; with derived ids it is
  // about one in four billion, and it is refused, never relied on.
  const held = new Set(Array.isArray(refs.meta_ad_ids) ? (refs.meta_ad_ids as unknown[]) : []);
  if (out.ok && out.ads.some((a) => held.has(a.meta_ad_id))) return { ok: false, error_code: "adopted_existing_ad", response: { ads: out.ads.map((a) => a.meta_ad_id) } };
  return out;
}

/** What the publisher needs, read from our rows: the brief, the connection and both Graph clients. */
async function publishContext(deps: PublishCampaignDeps, c: CampaignRow, creatives: PublishCreative[], key: string): Promise<{ ok: true; publisher: PublisherDeps; input: PublishInput } | { ok: false; error_code: string }> {
  const { admin } = deps;
  const { data: extra, error } = await admin.from("ads_campaigns").select("brief_source, brief_ref, brief_snapshot, created_at").eq("org_id", c.org_id).eq("id", c.id).maybeSingle();
  if (error) throw new Error(`ads_campaigns ${c.id}: ${error.message}`);
  if (!extra) return { ok: false, error_code: "campaign_not_found" };
  const campaign = extra as CampaignExtra;
  const brief = adBriefSchema.safeParse(campaign.brief_snapshot);
  if (!brief.success) return { ok: false, error_code: "brief_unparseable" };

  const { data: conn, error: cErr } = await admin.from("ads_platform_connections")
    .select("id, org_id, provider, is_sandbox, token_sealed, page_token_sealed, account_ref, page_ref, status")
    .eq("org_id", c.org_id).eq("id", c.connection_id).maybeSingle();
  if (cErr) throw new Error(`ads_platform_connections: ${cErr.message}`);
  const row = conn as ConnectionRow | null;
  if (!row || row.status === "disconnected") return { ok: false, error_code: "no_platform" };
  const graph = await graphForConnection(deps, row);
  const pageGraph = await pageGraphForConnection(deps, row);
  if (!graph.ok || !pageGraph.ok) return { ok: false, error_code: "no_platform" };

  return {
    ok: true,
    publisher: { admin, graph: graph.graph, pageGraph: pageGraph.graph, readAsset: deps.readAsset, now: deps.now },
    input: {
      orgId: c.org_id, campaignId: c.id, connectionId: c.connection_id,
      accountId: row.account_ref ?? "", pageId: row.page_ref ?? "",
      platform: row.provider === "simulator" ? "simulator" : "meta",
      brief_source: campaign.brief_source, brief_ref: campaign.brief_ref, created_at: campaign.created_at,
      area: brief.data.area, form_questions: brief.data.form_questions, claims: brief.data.claims,
      daily_budget_cents: c.daily_budget_cents, lifetime_cap_cents: c.lifetime_cap_cents,
      creatives,
      privacy_url: `${deps.env.WEB_APP_URL.replace(/\/+$/, "")}/privacy`,
      key,
    },
  };
}

/** The campaign's approved creatives, each with its preset's key and the words Meta shows (`platform_slots`). */
export async function approvedCreatives(admin: SupabaseClient, c: Pick<CampaignRow, "org_id" | "id">): Promise<PublishCreative[]> {
  const { data, error } = await admin.from("ads_creatives").select("id, preset_version_id, copy, assets")
    .eq("org_id", c.org_id).eq("campaign_id", c.id).eq("state", "approved").order("created_at", { ascending: true });
  if (error) throw new Error(`ads_creatives: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; preset_version_id: string; copy: PublishCreative["copy"] | null; assets: PublishCreative["assets"] }>;
  if (rows.length === 0) return [];

  const versionIds = [...new Set(rows.map((r) => r.preset_version_id))];
  const { data: vs, error: vErr } = await admin.from("ad_concept_preset_versions").select("id, preset_id, recipe").eq("org_id", c.org_id).in("id", versionIds);
  if (vErr) throw new Error(`ad_concept_preset_versions: ${vErr.message}`);
  const versions = new Map(((vs ?? []) as Array<{ id: string; preset_id: string; recipe: unknown }>).map((v) => [v.id, v]));

  const presetIds = [...new Set([...versions.values()].map((v) => v.preset_id))];
  const { data: ps, error: pErr } = await admin.from("ad_concept_presets").select("id, key").eq("org_id", c.org_id).in("id", presetIds);
  if (pErr) throw new Error(`ad_concept_presets: ${pErr.message}`);
  const keys = new Map(((ps ?? []) as Array<{ id: string; key: string }>).map((p) => [p.id, p.key]));

  return rows.map((r) => {
    const v = versions.get(r.preset_version_id);
    if (!v) throw new Error(`ads_creatives ${r.id}: preset version ${r.preset_version_id} not found`);
    const key = keys.get(v.preset_id);
    if (!key) throw new Error(`ad_concept_preset_versions ${v.id}: preset ${v.preset_id} not found`);
    const recipe = adPresetRecipeSchema.parse(v.recipe);
    return { id: r.id, preset_key: key, copy: r.copy ?? {}, assets: r.assets, platform_slots: recipe.platform_slots ?? null };
  });
}
