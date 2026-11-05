import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADS_PERSON_DOOR_EXCLUDED, adBriefSchema, stepCampaign,
  type AdBriefSource, type AdsCampaignCreate, type AdsCampaignCreateRefusal, type AdsCampaignLaunch, type AdsCampaignMove,
  type AdsCampaignSummary, type AdsCampaignView, type AdsCreativeView, type CampaignState,
} from "@silvicom/shared";
import { listBrandKits } from "../creative/kitVersions.js";
import { findCoveringApproval } from "../guard/approvals.js";
import { applyCampaignEvent, insertCampaign, loadCampaign, type TransitionResult } from "../orchestrator/transitions.js";
import { settingsInForce, type Actor } from "../settings/settingsVersions.js";
import { hasApprovedCreative } from "./creativeDecisions.js";

/**
 * The campaign doors behind `/api/ads/campaigns` (ADS-AGENT-BUILD-WORKFLOW Track S, S1b). Create, list, read.
 * And (S1c) the moves a person makes on a campaign, and the approver's launch. Deciding a creative is S1d.
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

// ── S1c: a person's moves, and the approver's launch ─────────────────────────────────────────────
export type MoveOutcome =
  | { kind: "moved"; to: CampaignState }
  | { kind: "not_found" }
  /** The machine said no (illegal from this state, or not a person's to cause), or the door excludes it. */
  | { kind: "refused"; reason: "illegal_transition" | "actor_not_allowed" | "not_this_door" | "no_approved_creative" }
  /** Someone else moved the campaign first (`state_moved`), or this exact move was already recorded. */
  | { kind: "conflict" }
  /** Launch only: no standing approval covers these amounts, or a second approver is still owed. */
  | { kind: "needs_approval"; refusal: "no_standing_approval" | "second_approver_missing" };

const fromTransition = (r: TransitionResult): MoveOutcome => {
  switch (r.kind) {
    case "moved": return { kind: "moved", to: r.to };
    case "no_op": return { kind: "moved", to: r.state };
    case "refused": return { kind: "refused", reason: r.reason };
    case "state_moved": case "already_recorded": return { kind: "conflict" };
  }
};

/**
 * Regenerate, archive, pause, resume, create paused: whatever the machine lets a PERSON cause from the
 * campaign's state, except the events with their own door (`ADS_PERSON_DOOR_EXCLUDED`). The move and its
 * record are `applyCampaignEvent`'s, as an agent's are, so a person's press and the runner race safely.
 */
export async function personMove(admin: SupabaseClient, orgId: string, actor: Actor, campaignId: string, ask: AdsCampaignMove, at: Date): Promise<MoveOutcome> {
  if (ADS_PERSON_DOOR_EXCLUDED.includes(ask.event)) return { kind: "refused", reason: "not_this_door" };
  const c = await loadCampaign(admin, orgId, campaignId);
  if (!c) return { kind: "not_found" };
  // S1d: "the creatives are approved" is a claim about rows — at least one a person approved — not a button.
  if (ask.event === "creatives_approved" && !(await hasApprovedCreative(admin, orgId, campaignId))) return { kind: "refused", reason: "no_approved_creative" };
  return fromTransition(await applyCampaignEvent(admin, c, {
    event: ask.event, actor: { kind: "person", id: actor.id, name: actor.name }, cause: ask.reason ?? `${actor.name}: ${ask.event}`,
  }, at.toISOString()));
}

/**
 * `paused → launching` by an approver, at the amounts given. The approval itself is a separate act
 * (`POST /campaigns/:id/approvals`, one yes per person, and two people above the second-approver line):
 * this door checks that a standing approval covers these amounts with the guard's own rule
 * (`findCoveringApproval`), and moves only then — so a launch that a second approver still owes never
 * leaves `paused`. The guard checks again at the platform call, against the caps then in force; that
 * check, not this one, is the one that can spend.
 */
export async function launchCampaign(admin: SupabaseClient, orgId: string, actor: Actor, campaignId: string, ask: AdsCampaignLaunch, at: Date): Promise<MoveOutcome> {
  const c = await loadCampaign(admin, orgId, campaignId);
  if (!c) return { kind: "not_found" };
  const step = stepCampaign(c.state, "launch", "approver");
  if (!step.ok) return { kind: "refused", reason: step.reason };
  const { settings } = await settingsInForce(admin, orgId);
  const verdict = await findCoveringApproval(admin, orgId, settings, {
    campaignId, kind: "launch", daily_cents: ask.daily_budget_cents, lifetime_cents: ask.lifetime_cap_cents,
  });
  if (!verdict.ok) return { kind: "needs_approval", refusal: verdict.refusal };
  return fromTransition(await applyCampaignEvent(admin, c, {
    event: "launch", actor: { kind: "approver", id: actor.id, name: actor.name },
    cause: `${actor.name} launched at ${ask.daily_budget_cents} cents a day, ${ask.lifetime_cap_cents} cents in all`,
    budget: { daily_budget_cents: ask.daily_budget_cents, lifetime_cap_cents: ask.lifetime_cap_cents },
  }, at.toISOString()));
}
