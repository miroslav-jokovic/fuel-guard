import type { SupabaseClient } from "@supabase/supabase-js";
import { medianMinutes, type LeadQuality, type LeadQualityCounts } from "@silvicom/shared";
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
    };
  });
}
