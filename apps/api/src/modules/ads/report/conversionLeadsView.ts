import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONVERSION_LEADS_WINDOW_DAYS, conversionLeadsReadiness, outcomeFeedOf,
  type ConversionLeadsView, type LeadSources,
} from "@silvicom/shared";
import { settingsInForce } from "../settings/settingsVersions.js";

/**
 * `GET /api/ads/conversion-leads` (ADS-PLATFORM-V2-PLAN V7e): how near the carrier is to what Meta asks before its
 * qualified-lead goal, each requirement measured on our own rows. A read only; the switch is not built (Q-AD17).
 * Shared `conversionLeads.ts` says what each check measures and why.
 *
 *   leads     recruiting's `LeadSources` (D-AD17), Meta's channel only: the last 30 days, and the cohort 29 to 58
 *             days old whose 28-day window has closed;
 *   covered   the lead ids with an event Meta accepted (`ads_outcome_events.status = 'sent'`, provider `meta`),
 *             read from the event's ref, `<lead id>:<stage>` (`outcomeEventRef`); any stage counts, as Meta's
 *             "leads that have matching events" does;
 *   feed      the settings in force (`outcomeFeedOf`).
 * Every query names the org: the service role bypasses RLS.
 */

const DAY = 86_400_000;
const PAGE = 1000;
const META = "meta";

export async function adsConversionLeadsView(admin: SupabaseClient, sources: LeadSources, orgId: string, now: Date): Promise<ConversionLeadsView> {
  const at = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const window = CONVERSION_LEADS_WINDOW_DAYS;
  const [recentAll, cohortAll, { settings }] = await Promise.all([
    sources.everyLeadBetween(orgId, at(window), now.toISOString()),
    sources.everyLeadBetween(orgId, at(2 * window - 2), at(window - 1)),
    settingsInForce(admin, orgId),
  ]);
  const recent = recentAll.filter((l) => l.channel === META);
  const cohort = cohortAll.filter((l) => l.channel === META);

  // Every event row of a lead is created after the lead arrived, so the rows created since the window opened hold
  // every event of every lead in it; a row of an older lead is read and simply matches no recent lead.
  const covered = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("ads_outcome_events").select("source_event_ref")
      .eq("org_id", orgId).eq("provider", META).eq("status", "sent").gte("created_at", at(window))
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`ads_outcome_events: ${error.message}`);
    const rows = (data ?? []) as Array<{ source_event_ref: string }>;
    for (const r of rows) covered.add(r.source_event_ref.split(":")[0]!);
    if (rows.length < PAGE) break;
  }

  return conversionLeadsReadiness({ now, recent, cohort, covered, feed: outcomeFeedOf(settings) });
}
