import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAD_LOST_REASONS, medianMinutes, type LeadLostReason, type LeadQuality, type LeadQualityCounts } from "@silvicom/shared";
import { allPages, byIds } from "./leadOutcomes.js";
import { readLeadVerdicts } from "./verdicts.js";

/**
 * Recruiting's `LeadQuality` (ADS-LEAD-QUALITY-PLAN LQ3; shared `ads/leadQuality.ts` says what each count is).
 * Injected into the ads module's daily job (`queue/handlers/adsDailyBrief.ts`), the `LeadOutcomes` pattern
 * (Q-AD34): ads never reads `recruiting_leads`, `recruiting_contacts` or `lead_match_verdicts` (D-AD17).
 *
 * Reads: the window's ad leads (`campaign_ref` set — a typed-in lead has none), their contacts (outcome and
 * time), and their verdicts through `readLeadVerdicts` — the newest verdict per requirement, the same reading
 * the queue shows a recruiter, so the alert can never count a lead as unqualified that the queue does not.
 * Ids go 100 at a time (`byIds`; readLeadVerdicts' own bound), every read pages past PostgREST's 1,000.
 * A purged lead (0558) has no verdicts and no contacts left, so it counts only as a lead.
 *
 * ── CLOSED, BY REASON (LR4, ADS-AGENTS-AUDIT-2026-11-10 F-LR5) ────────────────────────────────────
 * `recruiting_lead_closures` (0578) is append-only, one row per act, ordered by `seq`; a lead's state is its
 * NEWEST row. So a lead counts as closed for a reason only while that close is its newest act: closed then
 * reopened is open, closed twice counts once under the later reason. Only `LEAD_LOST_REASONS` are counted
 * here — a `not_qualified:<requirement>` close already wrote the verified verdict `not_qualified` above reads,
 * and one lead must not be in both. Every lost reason is in the answer, zero included, so the key set is the
 * contract's and not whatever happened to occur.
 */
export function recruitingLeadQuality(admin: SupabaseClient): LeadQuality {
  return { qualitySince: (orgId, since) => readLeadQuality(admin, orgId, since) };
}

const CHUNK = 100;

export async function readLeadQuality(admin: SupabaseClient, orgId: string, since: string): Promise<LeadQualityCounts[]> {
  const leads = (await allPages("recruiting_leads", () => admin.from("recruiting_leads")
    .select("id, campaign_ref, received_at").eq("org_id", orgId).not("campaign_ref", "is", null).gte("received_at", since).order("id")))
    .map((l) => ({ id: String(l.id), campaign: String(l.campaign_ref), at: Date.parse(String(l.received_at)) }));
  if (leads.length === 0) return [];
  const ids = leads.map((l) => l.id);

  const first = new Map<string, number>();
  const wrong = new Set<string>();
  const reached = new Set<string>();
  for (const c of await byIds("recruiting_contacts", ids, (chunk) => admin.from("recruiting_contacts")
    .select("lead_id, outcome, contacted_at").eq("org_id", orgId).in("lead_id", chunk).order("id"))) {
    const id = String(c.lead_id);
    const at = Date.parse(String(c.contacted_at));
    first.set(id, Math.min(first.get(id) ?? at, at));
    if (c.outcome === "wrong_number") wrong.add(id);
    if (c.outcome === "reached") reached.add(id);
  }

  const notQualified = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const verdicts = await readLeadVerdicts(admin, orgId, ids.slice(i, i + CHUNK));
    for (const [id, v] of verdicts) if (v.verdicts.some((x) => x.hard && x.verdict === "does_not_meet")) notQualified.add(id);
  }

  // Ascending `seq`, so the last row written per lead is its newest act.
  const newest = new Map<string, { kind: string; reason: string | null }>();
  for (const c of await byIds("recruiting_lead_closures", ids, (chunk) => admin.from("recruiting_lead_closures")
    .select("lead_id, kind, reason, seq").eq("org_id", orgId).in("lead_id", chunk).order("seq"))) {
    newest.set(String(c.lead_id), { kind: String(c.kind), reason: c.reason === null || c.reason === undefined ? null : String(c.reason) });
  }
  const closedFor = (leadId: string): LeadLostReason | null => {
    const act = newest.get(leadId);
    return act?.kind === "closed" && (LEAD_LOST_REASONS as readonly string[]).includes(act.reason ?? "") ? (act.reason as LeadLostReason) : null;
  };

  const byCampaign = new Map<string, typeof leads>();
  for (const l of leads) byCampaign.set(l.campaign, [...(byCampaign.get(l.campaign) ?? []), l]);
  return [...byCampaign].map(([campaign_id, ls]) => {
    const tried = ls.filter((l) => first.has(l.id));
    return {
      campaign_id,
      leads: ls.length,
      attempted: tried.length,
      wrong_number: tried.filter((l) => wrong.has(l.id)).length,
      reached: tried.filter((l) => reached.has(l.id)).length,
      not_qualified: ls.filter((l) => notQualified.has(l.id)).length,
      median_first_attempt_minutes: medianMinutes(tried.map((l) => Math.max(0, Math.round((first.get(l.id)! - l.at) / 60_000)))),
      closed: Object.fromEntries(LEAD_LOST_REASONS.map((reason) => [reason, ls.filter((l) => closedFor(l.id) === reason).length])),
    };
  });
}
