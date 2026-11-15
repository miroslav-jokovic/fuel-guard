import type { SupabaseClient } from "@supabase/supabase-js";
import { campaignPlanSchema, checkPlan, evidencePackSchema, type AdBrief, type CampaignPlan, type EvidencePack, type PlanFinding } from "@silvicom/shared";

/**
 * The ONE writer of `ads_campaign_plans` (0606; ADS-PLATFORM-V2-PLAN V2c). A plan is a VERSION: the
 * Strategist's is a row, a person's edit is the next row, and nothing changes a row once written (the table is
 * append-only, AX010) — so "what did the model propose and what did we run" stays two rows.
 *
 * ── NO UNCHECKED PLAN IS EVER A ROW ────────────────────────────────────────────────────────────────────
 * Both doors here parse the plan against the shared contract and run `checkPlan` before the insert, and a plan
 * with any finding is refused whole — the agent's and the person's alike. The check lives at the writer and not
 * at each caller, so a later caller cannot forget it: an edited plan that cites evidence the pack does not hold,
 * or says a figure the opening does not, is refused by the same code that refuses the model's.
 *
 * ── THE EVIDENCE TRAVELS WITH THE PLAN ─────────────────────────────────────────────────────────────────
 * A person edits the PLAN, never the evidence: their version carries the pack of the version they edited,
 * copied whole, so every id their angles cite resolves in their own row after the opening, the figures and
 * the window have moved on.
 *
 * ── VERSIONS AND THE QUEUE'S SECOND RUN ────────────────────────────────────────────────────────────────
 * The planning step can run twice (the queue is at-least-once). The Strategist's call replays under its key
 * and answers the same generation id, so the agent's door looks for that generation's row first and hands it
 * back. `unique (org_id, campaign_id, version)` settles two writers racing for one number: the loser of an
 * agent's race re-reads by generation, the loser of a person's race is told the plan moved (`stale`).
 */

export interface PlanRow {
  id: string;
  campaign_id: string;
  version: number;
  plan: CampaignPlan;
  evidence: EvidencePack;
  author_kind: "agent" | "person";
  generation_id: string | null;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
}

const COLUMNS = "id, campaign_id, version, plan, evidence, author_kind, generation_id, author_id, author_name, created_at";
const UNIQUE_VIOLATION = "23505";

export type StorePlanOutcome =
  | { kind: "stored"; plan: PlanRow; replayed: boolean }
  /** `checkPlan` found something, or the plan is not a plan at all (`off_schema`). Nothing was written. */
  | { kind: "refused"; findings: PlanFinding[]; off_schema: string | null }
  /** A person's edit of a version that is no longer the newest; `latest` is the newest, or null when none exists. */
  | { kind: "stale"; latest: number | null };

/** The newest version of a campaign's plan, or null when it has never been planned. */
export async function latestPlan(admin: SupabaseClient, orgId: string, campaignId: string): Promise<PlanRow | null> {
  const { data, error } = await admin
    .from("ads_campaign_plans").select(COLUMNS)
    .eq("org_id", orgId).eq("campaign_id", campaignId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`ads_campaign_plans: ${error.message}`);
  return (data as PlanRow | null) ?? null;
}

/** One version by its id — of this org AND this campaign, so an id from another campaign is "none". */
export async function planById(admin: SupabaseClient, orgId: string, campaignId: string, planId: string): Promise<PlanRow | null> {
  const { data, error } = await admin
    .from("ads_campaign_plans").select(COLUMNS)
    .eq("org_id", orgId).eq("campaign_id", campaignId).eq("id", planId).maybeSingle();
  if (error) throw new Error(`ads_campaign_plans: ${error.message}`);
  return (data as PlanRow | null) ?? null;
}

async function planByGeneration(admin: SupabaseClient, orgId: string, campaignId: string, generationId: string): Promise<PlanRow | null> {
  const { data, error } = await admin
    .from("ads_campaign_plans").select(COLUMNS)
    .eq("org_id", orgId).eq("campaign_id", campaignId).eq("generation_id", generationId).maybeSingle();
  if (error) throw new Error(`ads_campaign_plans: ${error.message}`);
  return (data as PlanRow | null) ?? null;
}

function refusal(plan: unknown, evidence: unknown, brief: Pick<AdBrief, "claims">): { plan: CampaignPlan; evidence: EvidencePack } | Extract<StorePlanOutcome, { kind: "refused" }> {
  const p = campaignPlanSchema.safeParse(plan);
  if (!p.success) return { kind: "refused", findings: [], off_schema: `plan: ${p.error.issues[0]?.message ?? "invalid"}` };
  const e = evidencePackSchema.safeParse(evidence);
  if (!e.success) return { kind: "refused", findings: [], off_schema: `evidence: ${e.error.issues[0]?.message ?? "invalid"}` };
  const findings = checkPlan(p.data, e.data, brief);
  return findings.length > 0 ? { kind: "refused", findings, off_schema: null } : { plan: p.data, evidence: e.data };
}

export interface AgentPlanInput {
  orgId: string;
  campaignId: string;
  /** The Strategist's `ad_generations` row — the plan's provenance (D-AD13) and this door's replay key. */
  generationId: string;
  plan: unknown;
  evidence: unknown;
  brief: Pick<AdBrief, "claims">;
}

/** The Strategist's plan, as the campaign's next version (1 on the first planning, n+1 after a `replan`). */
export async function storeAgentPlan(admin: SupabaseClient, input: AgentPlanInput): Promise<StorePlanOutcome> {
  const checked = refusal(input.plan, input.evidence, input.brief);
  if ("kind" in checked) return checked;
  const done = await planByGeneration(admin, input.orgId, input.campaignId, input.generationId);
  if (done) return { kind: "stored", plan: done, replayed: true };

  const latest = await latestPlan(admin, input.orgId, input.campaignId);
  const { data, error } = await admin.from("ads_campaign_plans").insert({
    org_id: input.orgId, campaign_id: input.campaignId, version: (latest?.version ?? 0) + 1,
    plan: checked.plan, evidence: checked.evidence, author_kind: "agent", generation_id: input.generationId,
  }).select(COLUMNS).single();
  if (!error) return { kind: "stored", plan: data as PlanRow, replayed: false };
  if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw new Error(`ads_campaign_plans insert: ${error.message}`);
  // Lost the race for this version number. If the winner was this same generation's other run, its row answers.
  const winner = await planByGeneration(admin, input.orgId, input.campaignId, input.generationId);
  if (winner) return { kind: "stored", plan: winner, replayed: true };
  throw new Error("ads_campaign_plans: the version was taken by another writer; the step runs again");
}

export interface PersonPlanInput {
  orgId: string;
  campaignId: string;
  /** The version the person had open. Their edit is refused as `stale` unless it is still the newest. */
  basedOnVersion: number;
  author: { id: string; name: string };
  plan: unknown;
  brief: Pick<AdBrief, "claims">;
}

/** A person's edited plan, as the version after the one they edited, on that version's evidence. */
export async function storePersonPlan(admin: SupabaseClient, input: PersonPlanInput): Promise<StorePlanOutcome> {
  const latest = await latestPlan(admin, input.orgId, input.campaignId);
  if (!latest || latest.version !== input.basedOnVersion) return { kind: "stale", latest: latest?.version ?? null };
  const checked = refusal(input.plan, latest.evidence, input.brief);
  if ("kind" in checked) return checked;

  const { data, error } = await admin.from("ads_campaign_plans").insert({
    org_id: input.orgId, campaign_id: input.campaignId, version: latest.version + 1,
    plan: checked.plan, evidence: checked.evidence, author_kind: "person", author_id: input.author.id, author_name: input.author.name,
  }).select(COLUMNS).single();
  if (!error) return { kind: "stored", plan: data as PlanRow, replayed: false };
  if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw new Error(`ads_campaign_plans insert: ${error.message}`);
  const now = await latestPlan(admin, input.orgId, input.campaignId);
  return { kind: "stale", latest: now?.version ?? null };
}
