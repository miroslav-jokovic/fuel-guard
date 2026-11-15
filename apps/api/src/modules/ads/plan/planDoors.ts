import type { SupabaseClient } from "@supabase/supabase-js";
import { adBriefSchema, type AdsCampaignPlanView, type AdsPlanApproval, type AdsPlanEdit, type PlanConcept, type PlanFinding } from "@silvicom/shared";
import { fromTransition, type MoveOutcome } from "../campaigns/campaignDoors.js";
import { applyCampaignEvent, loadCampaign } from "../orchestrator/transitions.js";
import type { Actor } from "../settings/settingsVersions.js";
import { availableConcepts } from "./concepts.js";
import { latestPlan, storePersonPlan, type PlanRow } from "./planStore.js";

/**
 * The doors a person uses on a campaign's plan (ADS-PLATFORM-V2-PLAN V2c): read it, save an edited version,
 * approve a version. `plan_approved` is excluded from the general moves door (`ADS_PERSON_DOOR_EXCLUDED`)
 * because it must name the plan; this is its door.
 *
 * ── A PERSON APPROVES WHAT THEY READ, AND ONLY THE NEWEST ──────────────────────────────────────────────
 * Approval names a version by id, and that version must be the campaign's newest. Two people on one plan is
 * the case: one saves an edit while the other still has the earlier version open and presses Approve. Without
 * this rule the campaign would compose from the version the second person saw, silently discarding the first
 * person's edit; with it the second is told the plan changed and reads it again. The database holds the other
 * half (AX032): the id must be a plan of this campaign.
 *
 * ── BOTH DOORS ARE OPEN ONLY IN `plan_review` ──────────────────────────────────────────────────────────
 * The machine already refuses `plan_approved` from any other state. An edit moves no state, so the machine has
 * no say; the door asks itself — a plan edited while the Strategist is still writing, or after the ads were
 * made from it, would be a version nobody approved sitting newest on a campaign that has moved on.
 */

const view = (p: PlanRow): AdsCampaignPlanView => ({
  id: p.id, version: p.version, plan: p.plan, evidence: p.evidence, author_kind: p.author_kind, author_name: p.author_name, created_at: p.created_at,
});

export async function readPlan(admin: SupabaseClient, orgId: string, campaignId: string): Promise<{ kind: "not_found" } | { kind: "ok"; plan: AdsCampaignPlanView | null; concepts: PlanConcept[] }> {
  const c = await loadCampaign(admin, orgId, campaignId);
  if (!c) return { kind: "not_found" };
  const latest = await latestPlan(admin, orgId, campaignId);
  // Read only when there is a plan to edit: the editor offers these, and the edit door holds an edit to the same read.
  return { kind: "ok", plan: latest ? view(latest) : null, concepts: latest ? await availableConcepts(admin, orgId) : [] };
}

export type PlanEditOutcome =
  | { kind: "saved"; plan: AdsCampaignPlanView }
  | { kind: "not_found" }
  | { kind: "not_in_plan_review" }
  /** The plan moved since the person opened it; `latest` is the newest version's number. */
  | { kind: "stale"; latest: number | null }
  | { kind: "refused"; findings: PlanFinding[]; off_schema: string | null };

export async function savePlanEdit(admin: SupabaseClient, orgId: string, actor: Actor, campaignId: string, ask: AdsPlanEdit): Promise<PlanEditOutcome> {
  const { data, error } = await admin.from("ads_campaigns").select("state, brief_snapshot").eq("org_id", orgId).eq("id", campaignId).maybeSingle();
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  if (!data) return { kind: "not_found" };
  const row = data as { state: string; brief_snapshot: unknown };
  if (row.state !== "plan_review") return { kind: "not_in_plan_review" };
  // The brief is frozen at creation (AX031) and parsed when the campaign was planned; one that fails here is a fault of ours.
  const brief = adBriefSchema.parse(row.brief_snapshot);
  // The kinds of ad that can be made TODAY: a person's edit is held to the presets as they are now, not as they were when the agent planned.
  const out = await storePersonPlan(admin, { orgId, campaignId, basedOnVersion: ask.based_on_version, author: actor, plan: ask.plan, brief, concepts: await availableConcepts(admin, orgId) });
  return out.kind === "stored" ? { kind: "saved", plan: view(out.plan) } : out;
}

export type PlanApprovalOutcome = MoveOutcome | { kind: "stale"; latest: number | null };

export async function approvePlan(admin: SupabaseClient, orgId: string, actor: Actor, campaignId: string, ask: AdsPlanApproval, at: Date): Promise<PlanApprovalOutcome> {
  const c = await loadCampaign(admin, orgId, campaignId);
  if (!c) return { kind: "not_found" };
  const latest = await latestPlan(admin, orgId, campaignId);
  if (!latest || latest.id !== ask.plan_id) return { kind: "stale", latest: latest?.version ?? null };
  return fromTransition(await applyCampaignEvent(admin, c, {
    event: "plan_approved", actor: { kind: "person", id: actor.id, name: actor.name },
    cause: `${actor.name} approved plan version ${latest.version}`, plan_id: latest.id,
  }, at.toISOString()));
}
