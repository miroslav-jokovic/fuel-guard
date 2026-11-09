import type { SupabaseClient } from "@supabase/supabase-js";
import { adBriefSchema, adPresetRecipeSchema } from "@silvicom/shared";
import type { Env } from "../../../../env.js";
import type { PlatformOutcome } from "../adapter.js";
import { graphForConnection, pageGraphForConnection, type ConnectionForGraph, type RegistryDeps } from "../registry.js";
import type { CampaignRow } from "../../orchestrator/transitions.js";
import { publishPaused, type PublisherDeps } from "./publisher.js";
import type { PublishCreative } from "./publisherAds.js";

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

  return publishPaused({ admin, graph: graph.graph, pageGraph: pageGraph.graph, readAsset: deps.readAsset, now: deps.now }, {
    orgId: c.org_id, campaignId: c.id, connectionId: c.connection_id,
    accountId: row.account_ref ?? "", pageId: row.page_ref ?? "",
    platform: row.provider === "simulator" ? "simulator" : "meta",
    brief_source: campaign.brief_source, brief_ref: campaign.brief_ref, created_at: campaign.created_at,
    area: brief.data.area, form_questions: brief.data.form_questions, claims: brief.data.claims,
    daily_budget_cents: c.daily_budget_cents, lifetime_cap_cents: c.lifetime_cap_cents,
    creatives: await approvedCreatives(admin, c),
    privacy_url: `${deps.env.WEB_APP_URL.replace(/\/+$/, "")}/privacy`,
    key,
  });
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
