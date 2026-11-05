import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_ORG_TIMEZONE, foldCampaignSpend, foldLeadCohorts, leadOutcomeSchema, monthContext, monthToDateByPlatform, wallClockInZone, wallClockToUtc,
  type AdPlatform, type BriefFold, type LeadOutcomes, type SpendHourRow,
} from "@silvicom/shared";

/**
 * The brief's fold, read from stored rows (F1b; D-AD5): yesterday's campaigns and the month so far, from
 * `ads_spend_hourly` — the table the hourly insights pull writes and the monitor and the guard read — through
 * `adsReport.ts`'s own folds, so the brief, the settings page and the caps can never disagree on a figure.
 *
 * ── YESTERDAY, IN THE CARRIER'S ZONE ───────────────────────────────────────────────────────────────
 * The day reported is the whole zone-local day before `now` (Central, the zone every other ads day bucket
 * uses), so a brief written at 07:00 holds a day the pull has had seven hours to settle. The month is THAT
 * day's month: the brief written on 1 November reports 31 October and October's spend, not a November
 * with nothing in it. `days_left` counts the days after the reported one (0 on the month's last day).
 *
 * ── COHORTS, THROUGH RECRUITING'S LeadOutcomes (Q-AD34, ruled 2026-11-05) ─────────────────────────
 * Which stages each lead reached is recruiting's, and D-AD17 lets ads reach recruiting only through an
 * interface recruiting implements. `LeadOutcomes` is that interface (shared `leadOutcomes.ts`); the job's
 * composition root hands recruiting's in (`queue/handlers/adsDailyBrief.ts`), and nothing here reads a
 * recruiting table. Every row is parsed against the shared shape, so an implementation that drifts from the
 * contract fails the brief loudly rather than folding a stage it does not mean.
 *
 * The window is the last `COHORT_WEEKS` zone-local weeks up to the reported day's: long enough that the oldest
 * cohorts are past the fold's 28-day maturity, short enough to stay one screen. Stages nothing records
 * (`qualified`, `lost_before_conversion`) are `not_recorded` in every cohort (Q-AD37), never 0.
 */

const PAGE = 1000;
export const COHORT_WEEKS = 8;

/** The zone-local Monday `COHORT_WEEKS - 1` weeks before the reported day's week, as the instant it starts. */
export function cohortsSince(reported: string, zone: string = DEFAULT_ORG_TIMEZONE): string {
  const d = new Date(`${reported}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * (COHORT_WEEKS - 1));
  return new Date(wallClockToUtc({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 0, minute: 0, second: 0 }, zone)).toISOString();
}

/** The zone-local day before `now`: "YYYY-MM-DD" and its [start, end) in UTC. */
export function reportedDay(now: Date, zone: string = DEFAULT_ORG_TIMEZONE): { day: string; start: string; end: string } {
  const wc = wallClockInZone(now, zone);
  const today = Date.UTC(wc.year, wc.month - 1, wc.day);
  const y = new Date(today - 86_400_000);
  const at = (d: Date) => wallClockToUtc({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 0, minute: 0, second: 0 }, zone);
  return { day: y.toISOString().slice(0, 10), start: new Date(at(y)).toISOString(), end: new Date(at(new Date(today))).toISOString() };
}

export async function readBriefFold(admin: SupabaseClient, orgId: string, now: Date, leadOutcomes: LeadOutcomes): Promise<BriefFold> {
  const day = reportedDay(now);
  const month = monthContext(new Date(day.start));

  const rows: SpendHourRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("ads_spend_hourly").select("campaign_id, hour, spend_cents, impressions, clicks, leads")
      .eq("org_id", orgId).gte("hour", month.start).lt("hour", day.end)
      .order("campaign_id").order("hour").range(from, from + PAGE - 1);
    if (error) throw new Error(`ads_spend_hourly: ${error.message}`);
    const got = (data ?? []) as SpendHourRow[];
    // bigint columns arrive as strings or numbers depending on size; the fold adds numbers.
    rows.push(...got.map((h) => ({ ...h, spend_cents: Number(h.spend_cents), impressions: Number(h.impressions), clicks: Number(h.clicks), leads: Number(h.leads) })));
    if (got.length < PAGE) break;
  }

  const ids = [...new Set(rows.map((r) => r.campaign_id))];
  const campaigns = new Map<string, { name: string; platform: AdPlatform | undefined }>();
  if (ids.length > 0) {
    const { data, error } = await admin.from("ads_campaigns").select("id, name, connection_id").eq("org_id", orgId).in("id", ids);
    if (error) throw new Error(`ads_campaigns: ${error.message}`);
    const camps = (data ?? []) as Array<{ id: string; name: string; connection_id: string }>;
    const { data: conns, error: cErr } = await admin.from("ads_platform_connections").select("id, provider").eq("org_id", orgId).in("id", [...new Set(camps.map((c) => c.connection_id))]);
    if (cErr) throw new Error(`ads_platform_connections: ${cErr.message}`);
    const provider = new Map(((conns ?? []) as Array<{ id: string; provider: AdPlatform }>).map((c) => [c.id, c.provider]));
    for (const c of camps) campaigns.set(c.id, { name: c.name, platform: provider.get(c.connection_id) });
  }

  // PostgREST answers "2026-11-03T05:00:00+00:00", not our "…Z": compared as instants, never as strings.
  const [from, to] = [Date.parse(day.start), Date.parse(day.end)];
  const inDay = rows.filter((r) => Date.parse(r.hour) >= from && Date.parse(r.hour) < to);
  const platformOf = new Map([...campaigns].flatMap(([id, c]) => (c.platform ? [[id, c.platform] as const] : [])));
  return {
    day: day.day,
    month: { month: month.month, days_left: month.days_left - 1 },
    campaigns: foldCampaignSpend(inDay).map((t) => ({ ...t, name: campaigns.get(t.campaign_id)?.name ?? t.campaign_id })),
    month_to_date: monthToDateByPlatform(rows, platformOf, { start: month.start, end: day.end }).by_platform,
    cohorts: foldLeadCohorts((await leadOutcomes.outcomesSince(orgId, cohortsSince(day.day))).map((o) => leadOutcomeSchema.parse(o)), now),
  };
}
