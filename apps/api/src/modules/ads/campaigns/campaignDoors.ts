import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adBriefSchema,
  type AdBriefSource, type AdsCampaignCreate, type AdsCampaignCreateRefusal, type AdsCampaignSummary, type AdsCampaignView,
  type AdsCreativeView,
} from "@silvicom/shared";
import { listBrandKits } from "../creative/kitVersions.js";
import { insertCampaign } from "../orchestrator/transitions.js";
import { settingsInForce } from "../settings/settingsVersions.js";

/**
 * The campaign doors behind `/api/ads/campaigns` (ADS-AGENT-BUILD-WORKFLOW Track S, S1b). Create, list, read.
 * The moves a person makes on a campaign (regenerate, launch, archive) are S1c; deciding a creative is S1d.
 *
 * ── CREATE: EVERYTHING A CAMPAIGN NAMES IS CHECKED BEFORE THE ROW EXISTS ─────────────────────────
 *   · the brief, from the source the composition root handed in (D-AD17 — ads never reads an opening):
 *     an unknown source is the caller's mistake; a null brief is "nothing publishable under this ref";
 *   · the settings in force (0537: `settings_version_id` NOT NULL): with nothing saved there are no caps,
 *     and a campaign made under "no caps" is one nobody could launch — refused at the door, not at Launch;
 *   · the connection: this org's, and `connected` (a failing or disconnected one cannot create paused);
 *   · the brand kit (Q-AD28): this org's, not archived, with a saved version for compose to use.
 * The composite FKs (0537, 0566) refuse another org's ids anyway; these reads turn that into a reason a
 * person can act on. The insert is `transitions.ts`' (`ads_campaigns`' one writer).
 */

export type CreateOutcome =
  | { kind: "created" | "existing"; id: string }
  | { kind: "refused"; refusal: AdsCampaignCreateRefusal };

export interface CreateDeps {
  admin: SupabaseClient;
  briefSources: readonly AdBriefSource[];
}

export async function createCampaign(deps: CreateDeps, orgId: string, userId: string, ask: AdsCampaignCreate): Promise<CreateOutcome> {
  const { admin } = deps;
  const refuse = (refusal: AdsCampaignCreateRefusal): CreateOutcome => ({ kind: "refused", refusal });
  const source = deps.briefSources.find((s) => s.source === ask.brief_source);
  if (!source) return refuse("brief_source_unknown");
  const raw = await source.briefFor(orgId, ask.brief_ref);
  // A source's own answer is parsed too: the snapshot is what the claim checker trusts for the campaign's life.
  const brief = raw === null ? null : adBriefSchema.safeParse(raw);
  if (!brief || !brief.success) return refuse("brief_unavailable");

  const inForce = await settingsInForce(admin, orgId);
  if (!inForce.version_id) return refuse("settings_not_saved");

  const { data: conn, error } = await admin.from("ads_platform_connections").select("id, status").eq("org_id", orgId).eq("id", ask.connection_id).maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  if (!conn || (conn as { status: string }).status !== "connected") return refuse("connection_unusable");

  const kit = (await listBrandKits(admin, orgId)).find((k) => k.id === ask.brand_kit_id);
  if (!kit || kit.archived_at || !kit.current) return refuse("brand_kit_unusable");

  const out = await insertCampaign(admin, {
    id: ask.id, org_id: orgId, connection_id: ask.connection_id, brand_kit_id: ask.brand_kit_id,
    settings_version_id: inForce.version_id, brief: brief.data, name: ask.name?.trim() || brief.data.subject, created_by: userId,
  });
  return out.kind === "id_taken" ? refuse("id_taken") : out;
}

const SUMMARY = "id, name, state, state_changed_at, brief_source, brief_ref, connection_id, brand_kit_id, daily_budget_cents, lifetime_cap_cents, last_error, created_at";
const CREATIVE = "id, preset_version_id, brand_kit_version_id, supersedes_id, state, copy, assets, checks, regenerations, last_error, created_at";
/** Newest first; the list is a page of a person's recent work, not an export. */
export const CAMPAIGN_LIST_LIMIT = 200;

export async function listCampaigns(admin: SupabaseClient, orgId: string): Promise<AdsCampaignSummary[]> {
  const { data, error } = await admin.from("ads_campaigns").select(SUMMARY).eq("org_id", orgId).order("created_at", { ascending: false }).limit(CAMPAIGN_LIST_LIMIT);
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  return (data ?? []) as unknown as AdsCampaignSummary[];
}

export async function readCampaign(admin: SupabaseClient, orgId: string, id: string): Promise<AdsCampaignView | null> {
  const { data, error } = await admin.from("ads_campaigns").select(`${SUMMARY}, brief_snapshot, settings_version_id`).eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  if (!data) return null;
  const { data: cr, error: e2 } = await admin.from("ads_creatives").select(CREATIVE).eq("org_id", orgId).eq("campaign_id", id).order("created_at", { ascending: true });
  if (e2) throw new Error(`ads_creatives: ${e2.message}`);
  return { ...(data as unknown as Omit<AdsCampaignView, "creatives">), creatives: (cr ?? []) as unknown as AdsCreativeView[] };
}
