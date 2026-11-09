import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaGraph } from "../platforms/meta/graphClient.js";
import { graphForConnection, type RegistryDeps } from "../platforms/registry.js";
import { alertIfTokenRefused } from "../alerts/connectionAlerts.js";
import { bucketHour, isKnownZone, localHourToUtc, windowDays } from "./localHours.js";
import { isNoSuchObject, recordedGone } from "./recordedGone.js";
import { adRefsOf, adSpendRow, writeAdHours, type AdRef, type AdSpendRow } from "./adInsightsPull.js";

/**
 * The hourly insights pull (ADS-AGENT-BUILD-WORKFLOW.md B5a; §4R Monitor: "insights late, missing hours,
 * numbers revised downward by the platform"). For one connection: every campaign of ours Meta holds, its
 * campaign-level insights at hourly grain for the last `INSIGHTS_WINDOW_DAYS` local days, written to
 * `ads_spend_hourly` — the table the budget guard's month-to-date folds (`guard/budgetGuard.ts`), which
 * nothing wrote before this.
 *
 * ── A WINDOW, RE-READ WHOLE EVERY HOUR ───────────────────────────────────────────────────────────
 * Meta refreshes insights about every 15 minutes and keeps changing them for up to 28 days (Insights best
 * practices). So there is no "read up to" mark: every run reads the whole window again and writes Meta's
 * CURRENT answer for every hour in it. A late hour appears on the first run after Meta reports it; a number
 * Meta revised — down as well as up — replaces ours; an hour Meta no longer reports at all is written as
 * zero. That last one is deliberate: the table mirrors what the platform says now, and the guard does not
 * rely on it alone (it forecasts from the larger of this fold and Meta's own account spend, audit H4).
 * Revisions older than the window are B5c's daily reconcile's (a 28-day re-read), not this hourly job's.
 *
 * ── THE HOURS ARE THE ACCOUNT'S, THE TABLE'S ARE UTC ─────────────────────────────────────────────
 * The account's zone is read from Meta (`timezone_name`) at every run, never stored: the owner can change
 * it, and a stale copy would shift every hour. `localHours.ts` converts, including the two daylight-saving
 * days (its header). An unknown zone fails the run rather than guessing UTC.
 *
 * ── LEADS ARE ATTRIBUTED, NOT RECEIVED ───────────────────────────────────────────────────────────
 * `leads` is Meta's `actions` count for on-Meta leads (`onsite_conversion.lead_grouped`, else `lead`),
 * which Meta attributes to the hour of the IMPRESSION by default (`action_report_time`), with its default
 * windows. It will not match the hours recruiting's leads arrived in, and is not meant to: it is Meta's
 * cost-per-lead view. B5b's zero-lead check reads it over a window, never one hour at a time.
 *
 * ── WHAT IS NEVER SILENT ─────────────────────────────────────────────────────────────────────────
 * A campaign Meta refuses to report, a window with more than `PAGES_MAX` pages, a row of a shape we do not
 * read, and a local hour that does not exist are each reported in the result; the job fails on any of
 * them (`queue/handlers/adsInsights.ts`), so it is listed, and the next hour's run tries the window again.
 * A campaign whose read failed keeps its stored hours untouched — a failed read is never read as zero.
 *
 * One exception, and it is narrow (Q-AD35): a campaign Meta says does not exist, which reconcile has already
 * recorded as `missing` and rung, is passed over without a failure. Its stored hours stay, because that money was
 * spent. Before that record exists the refusal fails like any other (`recordedGone.ts`).
 */

export const INSIGHTS_WINDOW_DAYS = 3;
/** Meta's own revision horizon; a payload may widen one run's window this far, never further. */
export const INSIGHTS_MAX_DAYS = 28;
const PAGE_LIMIT = 200;
/** 20 × 200 = 4,000 rows for one campaign — 28 days is 672; past it is reported, never trusted. */
export const PAGES_MAX = 20;
const FIELDS = "campaign_id,spend,impressions,clicks,actions,account_currency";
/** The ad-level read (CQ3): the same figures, one row per ad, `ad_id` naming it. */
const AD_FIELDS = `ad_id,${FIELDS}`;
const BREAKDOWN = "hourly_stats_aggregated_by_advertiser_time_zone";
const WRITE_CHUNK = 500;

export interface InsightsDeps extends RegistryDeps {
  admin: SupabaseClient;
  /** Required (B4b trap): `MetaGraph` throws on `now: undefined`. */
  now: () => Date;
}

export interface InsightsFailure {
  campaign_id?: string;
  /**
   * `graph:<code>`, `truncated`, `shape`, `no_such_hour:<day> <hh>`, `account:<code>`, `zone`, `connection:<status>`;
   * the ad-level read's (CQ3) carry an `ads:` prefix, plus `ads:unknown_ad:<meta ad id>` for an ad our refs do not name.
   */
  reason: string;
}

export interface InsightsResult {
  connection_id: string;
  zone: string | null;
  days: string[];
  campaigns: number;
  hours_written: number;
  hours_zeroed: number;
  /** Per-ad rows (CQ3, `ads_ad_spend_hourly`): a campaign with no recorded ads contributes nothing here. */
  ad_hours_written: number;
  ad_hours_zeroed: number;
  failures: InsightsFailure[];
}

interface SpendRow {
  org_id: string;
  campaign_id: string;
  hour: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  currency: string;
  pulled_at: string;
}

interface MetaRow {
  ad_id?: unknown;
  date_start?: unknown;
  spend?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  actions?: Array<{ action_type?: unknown; value?: unknown }>;
  account_currency?: unknown;
  [BREAKDOWN]?: unknown;
}

const count = (v: unknown): number | null => {
  const n = v === undefined ? 0 : Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** On-Meta leads: Meta's grouped form-lead count when present, else `lead` (header). */
function leadsOf(actions: MetaRow["actions"]): number | null {
  if (actions !== undefined && !Array.isArray(actions)) return null;
  const by = new Map((actions ?? []).map((a) => [String(a?.action_type), a?.value]));
  return count(by.get("onsite_conversion.lead_grouped") ?? by.get("lead"));
}

/** One Meta row as one `ads_spend_hourly` row, or why not. Pure. */
export function spendRowFromMeta(row: MetaRow, ctx: { org_id: string; campaign_id: string; zone: string; currency: string; pulled_at: string }): SpendRow | { reason: string } {
  const hour = bucketHour(row[BREAKDOWN]);
  const day = typeof row.date_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date_start) ? row.date_start : null;
  const units = typeof row.spend === "string" || typeof row.spend === "number" ? Number(row.spend) : NaN;
  const impressions = count(row.impressions);
  const clicks = count(row.clicks);
  const leads = leadsOf(row.actions);
  const currency = typeof row.account_currency === "string" ? row.account_currency : ctx.currency;
  if (hour === null || !day || !Number.isFinite(units) || units < 0 || impressions === null || clicks === null || leads === null || !/^[A-Z]{3}$/.test(currency)) {
    return { reason: "shape" };
  }
  const at = localHourToUtc(day, hour, ctx.zone);
  if (!at) return { reason: `no_such_hour:${day} ${String(hour).padStart(2, "0")}` };
  return {
    org_id: ctx.org_id, campaign_id: ctx.campaign_id, hour: at.toISOString(),
    spend_cents: Math.round(units * 100), impressions, clicks, leads, currency, pulled_at: ctx.pulled_at,
  };
}

type Listing = { data?: MetaRow[]; paging?: { cursors?: { after?: string }; next?: string } };

/** The campaign's hourly rows at one level: `campaign` (one row per hour) or `ad` (one row per ad per hour). */
async function readCampaignHours(graph: MetaGraph, metaCampaignId: string, since: string, until: string, level: "campaign" | "ad" = "campaign"): Promise<{ ok: true; rows: MetaRow[]; truncated: boolean } | { ok: false; error_code: string; no_such_object: boolean }> {
  const rows: MetaRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const r = await graph.get<Listing>(`${metaCampaignId}/insights`, {
      level, fields: level === "ad" ? AD_FIELDS : FIELDS, breakdowns: BREAKDOWN, time_increment: 1,
      time_range: JSON.stringify({ since, until }), limit: PAGE_LIMIT, after,
    });
    if (!r.ok) return { ok: false, error_code: r.error.error_code, no_such_object: isNoSuchObject(r.error) };
    if (!Array.isArray(r.data.data)) return { ok: false, error_code: "shape", no_such_object: false };
    rows.push(...r.data.data);
    after = r.data.paging?.cursors?.after;
    if (!r.data.paging?.next || !after) return { ok: true, rows, truncated: false };
  }
  return { ok: true, rows, truncated: true };
}

/** The UTC instant a local day starts (its first hour that exists). */
function dayStartUtc(day: string, zone: string): Date {
  for (let h = 0; h < 4; h += 1) {
    const t = localHourToUtc(day, h, zone);
    if (t) return t;
  }
  throw new Error(`localHours: ${day} has no hour before 04:00 in ${zone}`);
}

const nextDay = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

interface CampaignRow { id: string; meta_campaign_id: string; ads: AdRef[] }

/** Our campaigns on this connection that Meta holds (a recorded campaign id), org-scoped; archived ones are done. */
async function campaignsOnPlatform(admin: SupabaseClient, orgId: string, connectionId: string): Promise<CampaignRow[]> {
  const out: CampaignRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("ads_campaigns").select("id, state, platform_refs")
      .eq("org_id", orgId).eq("connection_id", connectionId).neq("state", "archived")
      .order("id").range(from, from + 999);
    if (error) throw new Error(`ads_campaigns: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; platform_refs: Record<string, unknown> | null }>;
    for (const r of rows) {
      const id = r.platform_refs?.meta_campaign_id;
      if (typeof id === "string" && id) out.push({ id: r.id, meta_campaign_id: id, ads: adRefsOf(r.platform_refs) });
    }
    if (rows.length < 1000) return out;
  }
}

async function writeRows(admin: SupabaseClient, rows: SpendRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    // Every column of the table, so a row that already exists is REPLACED (a revision down included) and
    // the NOT NULL check before conflict arbitration has nothing to refuse (lint:upserts).
    const { error } = await admin.from("ads_spend_hourly").upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: "campaign_id,hour" });
    if (error) throw new Error(`ads_spend_hourly: ${error.message}`);
  }
}

/**
 * One connection's pull, and (monitor-alerts, 2026-11-06; ADS-RUNBOOK Gap 4) the bell when Meta refused its token:
 * the hourly pull is often the first thing to meet a dead token, and its failure alone rang nobody.
 */
export async function pullConnectionInsights(deps: InsightsDeps, orgId: string, connectionId: string, opts: { days?: number } = {}): Promise<InsightsResult> {
  const result = await pullOnce(deps, orgId, connectionId, opts);
  await alertIfTokenRefused(deps.admin, deps.now(), { org_id: orgId, connection_id: connectionId }, result.failures.map((f) => f.reason), "insights");
  return result;
}

async function pullOnce(deps: InsightsDeps, orgId: string, connectionId: string, opts: { days?: number }): Promise<InsightsResult> {
  const days = Math.min(INSIGHTS_MAX_DAYS, Math.max(1, Math.floor(opts.days ?? INSIGHTS_WINDOW_DAYS)));
  const result: InsightsResult = { connection_id: connectionId, zone: null, days: [], campaigns: 0, hours_written: 0, hours_zeroed: 0, ad_hours_written: 0, ad_hours_zeroed: 0, failures: [] };

  const { data: conn, error } = await deps.admin
    .from("ads_platform_connections").select("id, org_id, provider, is_sandbox, token_sealed, account_ref, status")
    .eq("org_id", orgId).eq("id", connectionId).maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const c = conn as { id: string; org_id: string; provider: string; is_sandbox: boolean; token_sealed: string | null; account_ref: string | null; status: string } | null;
  if (!c || (c.provider !== "meta" && c.provider !== "simulator")) return result;

  const campaigns = await campaignsOnPlatform(deps.admin, orgId, connectionId);
  if (campaigns.length === 0) return result;
  if (c.status === "disconnected" || !c.account_ref) {
    result.failures.push({ reason: `connection:${c.account_ref ? c.status : "no_account"}` });
    return result;
  }
  const opened = await graphForConnection(deps, c);
  if (!opened.ok) {
    result.failures.push({ reason: `graph:${opened.error_code}` });
    return result;
  }
  const account = await opened.graph.get<{ timezone_name?: unknown; currency?: unknown }>(`act_${c.account_ref}`, { fields: "timezone_name,currency" });
  if (!account.ok) {
    result.failures.push({ reason: `account:${account.error.error_code}` });
    return result;
  }
  const zone = account.data.timezone_name;
  if (!isKnownZone(zone)) {
    result.failures.push({ reason: "zone" });
    return result;
  }
  result.zone = zone;
  result.days = windowDays(deps.now(), zone, days);
  const since = result.days[0]!;
  const until = result.days[result.days.length - 1]!;
  const from = dayStartUtc(since, zone).toISOString();
  const to = dayStartUtc(nextDay(until), zone).toISOString();
  const pulledAt = deps.now().toISOString();
  const currency = typeof account.data.currency === "string" ? account.data.currency : "";

  for (const k of campaigns) {
    result.campaigns += 1;
    const read = await readCampaignHours(opened.graph, k.meta_campaign_id, since, until);
    if (!read.ok) {
      const settled = read.no_such_object && await recordedGone(deps.admin, orgId, connectionId, [{ level: "campaign", meta_id: k.meta_campaign_id }]);
      if (!settled) result.failures.push({ campaign_id: k.id, reason: `graph:${read.error_code}` });
      continue;
    }
    const fresh = new Map<string, SpendRow>();
    let whole = !read.truncated;
    if (read.truncated) result.failures.push({ campaign_id: k.id, reason: "truncated" });
    for (const row of read.rows) {
      const r = spendRowFromMeta(row, { org_id: orgId, campaign_id: k.id, zone, currency, pulled_at: pulledAt });
      if ("reason" in r) {
        result.failures.push({ campaign_id: k.id, reason: r.reason });
        whole = false;
        continue;
      }
      fresh.set(r.hour, r);
    }
    // An hour we hold that Meta no longer reports is zero now — but only when this read was complete.
    const zeroed: SpendRow[] = [];
    if (whole) {
      const { data: held, error: hErr } = await deps.admin
        .from("ads_spend_hourly").select("hour, currency, spend_cents, impressions, clicks, leads")
        .eq("org_id", orgId).eq("campaign_id", k.id).gte("hour", from).lt("hour", to).limit(1000);
      if (hErr) throw new Error(`ads_spend_hourly: ${hErr.message}`);
      for (const h of (held ?? []) as Array<{ hour: string; currency: string; spend_cents: number; impressions: number; clicks: number; leads: number }>) {
        const at = new Date(h.hour).toISOString();
        const nonZero = Number(h.spend_cents) > 0 || Number(h.impressions) > 0 || Number(h.clicks) > 0 || Number(h.leads) > 0;
        if (!fresh.has(at) && nonZero) {
          zeroed.push({ org_id: orgId, campaign_id: k.id, hour: at, spend_cents: 0, impressions: 0, clicks: 0, leads: 0, currency: h.currency, pulled_at: pulledAt });
        }
      }
    }
    await writeRows(deps.admin, [...fresh.values(), ...zeroed]);
    result.hours_written += fresh.size;
    result.hours_zeroed += zeroed.length;
    // The AD half (CQ3): only for a campaign whose refs name its ads — before the publisher ran there is no ad
    // to read, and a read for one would only be a failure with nothing behind it.
    if (k.ads.length > 0) await pullAdHours(deps, opened.graph, k, { orgId, zone, currency, pulledAt, since, until, from, to }, result);
  }
  return result;
}

type Window = { orgId: string; zone: string; currency: string; pulledAt: string; since: string; until: string; from: string; to: string };

/** The same window at `level=ad`, each row named to its creative by the campaign's refs, written per ad. */
async function pullAdHours(deps: InsightsDeps, graph: MetaGraph, k: CampaignRow, w: Window, result: InsightsResult): Promise<void> {
  const read = await readCampaignHours(graph, k.meta_campaign_id, w.since, w.until, "ad");
  if (!read.ok) {
    // The campaign-level read just succeeded on this object, so a refusal here is the read's, not a gone object.
    result.failures.push({ campaign_id: k.id, reason: `ads:graph:${read.error_code}` });
    return;
  }
  const fresh = new Map<string, AdSpendRow>();
  let whole = !read.truncated;
  if (read.truncated) result.failures.push({ campaign_id: k.id, reason: "ads:truncated" });
  for (const row of read.rows) {
    const base = spendRowFromMeta(row, { org_id: w.orgId, campaign_id: k.id, zone: w.zone, currency: w.currency, pulled_at: w.pulledAt });
    const r = "reason" in base ? base : adSpendRow(base, row.ad_id, k.ads);
    if ("reason" in r) {
      result.failures.push({ campaign_id: k.id, reason: `ads:${r.reason}` });
      whole = false;
      continue;
    }
    fresh.set(`${r.meta_ad_id}|${r.hour}`, r);
  }
  const out = await writeAdHours(deps.admin, { org_id: w.orgId, campaign_id: k.id }, [...fresh.values()], { from: w.from, to: w.to, whole, pulled_at: w.pulledAt });
  result.ad_hours_written += out.written;
  result.ad_hours_zeroed += out.zeroed;
}
