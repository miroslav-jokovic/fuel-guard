import { describe, expect, it } from "vitest";
import { ADS_SETTINGS_UNSET, checkSpend, type AdsSettings } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { adsSpendView } from "./spendView.js";

/**
 * "Spend control live" (E1c): every figure is the one the guard and the rails compute, over org-scoped reads.
 * The recorder applies no filter (memory "supabaseRecorder doesn't filter"), so each fixture answers by the
 * filters the query actually set — a read that forgot a filter gets the wrong rows and the numbers move.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const META = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const SIM = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const LIVE = "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a";
const PAUSED = "4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b";
const SIMC = "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c";
// Sunday 15 Nov 2026, noon Central: today began 06:00Z; 16 days left, today included.
const NOW = new Date("2026-11-15T18:00:00Z");

const SETTINGS: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  limits: { ...ADS_SETTINGS_UNSET.limits, monthly_cap_cents: { meta: 300_000 }, daily_max_cents: 10_000, lifetime_max_cents: 200_000 },
  budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 1_000_000, higgsfield_credits_monthly: 500 },
};

const hour = (campaign_id: string, at: string, spend_cents: number, leads = 0) => ({ campaign_id, hour: at, spend_cents, impressions: 100, clicks: 4, leads });
const HOURS: Record<string, ReturnType<typeof hour>[]> = {
  [LIVE]: [
    hour(LIVE, "2026-10-31T20:00:00Z", 9_000, 1), // October: lifetime only
    hour(LIVE, "2026-11-14T15:00:00Z", 4_000, 2), // this month, before today
    hour(LIVE, "2026-11-15T03:00:00Z", 300), // 9 pm Saturday in Central: yesterday, though it is the 15th in UTC
    hour(LIVE, "2026-11-15T07:00:00Z", 1_500, 1), // today
  ],
  [PAUSED]: [hour(PAUSED, "2026-11-02T15:00:00Z", 2_500)],
  [SIMC]: [hour(SIMC, "2026-11-15T09:00:00Z", 700)],
};

const val = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;
const selects = (q: RecordedQuery) => String(q.ops.find((o) => o.method === "select")?.args[0] ?? "");

function db(opts: { reconciledAt?: string | null; hours?: Record<string, ReturnType<typeof hour>[]> } = {}) {
  const campaigns = [
    { id: LIVE, name: "CDL-A Dallas", state: "live", connection_id: META, daily_budget_cents: 5_000, lifetime_cap_cents: 150_000 },
    { id: PAUSED, name: "CDL-A Tulsa", state: "paused", connection_id: META, daily_budget_cents: 3_000, lifetime_cap_cents: null },
    { id: SIMC, name: "Simulator test", state: "live", connection_id: SIM, daily_budget_cents: 1_000, lifetime_cap_cents: 10_000 },
  ];
  return createSupabaseRecorder({
    tables: {
      ads_settings_versions: [{ id: "v1", version: 4, settings: SETTINGS, kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "Owner" }],
      ads_platform_connections: (q) => {
        const all = [{ id: META, provider: "meta" }, { id: SIM, provider: "simulator" }];
        const p = val(q, "provider");
        return p ? all.filter((c) => c.provider === p) : all;
      },
      ads_campaigns: (q) => {
        const conns = val(q, "connection_id") as string[] | undefined;
        return conns ? campaigns.filter((c) => conns.includes(c.connection_id)) : campaigns;
      },
      ads_spend_hourly: (q) => {
        const all = opts.hours?.[val(q, "campaign_id") as string] ?? HOURS[val(q, "campaign_id") as string] ?? [];
        const arg = (m: string) => q.ops.find((o) => o.method === m && o.args[0] === "hour")?.args[1] as string | undefined;
        const [from, to] = [arg("gte"), arg("lt")];
        const inWindow = all.filter((r) => (!from || r.hour >= from) && (!to || r.hour < to));
        const range = q.ops.find((o) => o.method === "range")?.args as [number, number] | undefined;
        return range ? inWindow.slice(range[0], range[1] + 1) : inWindow;
      },
      ad_generations: (q) => (val(q, "provider") === "anthropic"
        ? [{ id: "g1", cost_units: 12_000 }, { id: "g2", cost_units: 3_000 }]
        : [{ id: "h1", status: "succeeded", cost_units: 40, price: "40" }]),
      jobs: (q) => (val(q, "dedup_key") === `ads_reconcile:${META}` && opts.reconciledAt !== null
        ? [{ id: "j1", kind: "ads_reconcile", status: "done", started_at: opts.reconciledAt ?? "2026-11-15T07:00:00Z" }]
        : []),
      // Two differences recorded; any other kind of row on the connection (a test, a pause) must not count.
      ads_actions: (q) => ({ data: [], count: val(q, "kind") === "external_change" ? 2 : 9 }),
    },
  });
}

describe("adsSpendView", () => {
  it("per platform: the guard's month-to-date, the saved cap, and the launch check's forecast", async () => {
    const rec = db();
    const v = await adsSpendView(rec.client, ORG, NOW);
    expect([v.month, v.today, v.days_left]).toEqual(["2026-11", "2026-11-15", 16]);
    const meta = v.platforms.find((p) => p.platform === "meta")!;
    // November only: 4,000 + 300 + 1,500 + 2,500. Live: only the live campaign's daily budget (the paused one cannot spend).
    expect(meta).toEqual({ platform: "meta", month_to_date_cents: 8_300, cap_cents: 300_000, live_daily_cents: 5_000, forecast_cents: 88_300 });
    expect(v.platforms.find((p) => p.platform === "simulator")).toMatchObject({ month_to_date_cents: 700, cap_cents: null });
  });

  it("the page's forecast is the number a launch at no extra budget would be checked against", async () => {
    const meta = (await adsSpendView(db().client, ORG, NOW)).platforms.find((p) => p.platform === "meta")!;
    const verdict = checkSpend(SETTINGS, {
      act: "launch", platform: "meta", kill_switch: false, daily_cents: 0, lifetime_cents: 0, current_daily_cents: null,
      month_to_date_cents: meta.month_to_date_cents, platform_month_to_date_cents: null, other_live_daily_cents: meta.live_daily_cents,
      account_headroom_cents: 100_000, days_left_in_month: 16,
    } as Parameters<typeof checkSpend>[1]);
    expect(verdict.forecast_cents).toBe(meta.forecast_cents);
  });

  it("per campaign: today in the carrier's day and the whole lifetime, through the fold", async () => {
    const v = await adsSpendView(db().client, ORG, NOW);
    expect(v.campaigns.find((c) => c.id === LIVE)).toEqual({
      id: LIVE, name: "CDL-A Dallas", state: "live", platform: "meta", daily_budget_cents: 5_000, lifetime_cap_cents: 150_000,
      today_spend_cents: 1_500, lifetime_spend_cents: 14_800, lifetime_leads: 4, lifetime_cost_per_lead_cents: 3_700,
    });
    expect(v.campaigns.find((c) => c.id === PAUSED)).toMatchObject({ today_spend_cents: 0, lifetime_leads: 0, lifetime_cost_per_lead_cents: null });
  });

  it("a campaign's lifetime reads every page of its hours, not the first thousand", async () => {
    const many = Array.from({ length: 1_200 }, (_, i) => hour(PAUSED, new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(), 1));
    const v = await adsSpendView(db({ hours: { [PAUSED]: many } }).client, ORG, NOW);
    expect(v.campaigns.find((c) => c.id === PAUSED)?.lifetime_spend_cents).toBe(1_200);
  });

  it("AI: the ledger's month folds against the saved budgets", async () => {
    expect((await adsSpendView(db().client, ORG, NOW)).ai).toEqual({ tokens_used: 15_000, tokens_budget: 1_000_000, credits_used: 40, credits_budget: 500 });
  });

  it("reconcile: the last finished run per Meta connection, the changes since, and late when it has stopped", async () => {
    expect((await adsSpendView(db().client, ORG, NOW)).reconcile).toEqual([
      { connection_id: META, provider: "meta", last_run_at: "2026-11-15T07:00:00Z", late: false, changes_since: 2 },
    ]);
    expect((await adsSpendView(db({ reconciledAt: "2026-11-13T17:00:00Z" }).client, ORG, NOW)).reconcile[0]).toMatchObject({ late: true });
    expect((await adsSpendView(db({ reconciledAt: null }).client, ORG, NOW)).reconcile[0]).toMatchObject({ last_run_at: null, late: true, changes_since: 0 });
  });

  it("every read is scoped to the caller's org", async () => {
    const rec = db();
    await adsSpendView(rec.client, ORG, NOW);
    expectOrgScoped(rec, ORG);
    expect(rec.writes()).toEqual([]);
  });

  it("drafts and campaigns still in review are not listed: they have spent nothing anywhere", async () => {
    const rec = db();
    await adsSpendView(rec.client, ORG, NOW);
    const listing = rec.forTable("ads_campaigns").find((q) => selects(q).includes("name"))!;
    expect(listing.filters().find((f) => f.col === "state")?.val).toEqual(["paused", "launching", "live", "pausing", "archived", "failed"]);
  });
});
