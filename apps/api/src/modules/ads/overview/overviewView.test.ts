import { describe, expect, it } from "vitest";
import { ADS_SETTINGS_UNSET, OVERVIEW_LEDGER_PAGE, parseLedgerCursor, type AdsSettings } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { adsOverviewView } from "./overviewView.js";
import { adsSpendView } from "../spend/spendView.js";

/**
 * The Overview read (V6): spend and leads are the spend read's, "Needs you" is the shared fold over these rows, and the
 * ledger pages by (started_at, id). The recorder applies no filter (memory "supabaseRecorder doesn't filter"), so each
 * fixture answers by the filters the query actually set.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const META = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const LIVE = "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a";
const REVIEW = "4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b";
const PAUSED_BY_DANA = "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c";
const PAUSED_BY_RULE = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";
const OLD = "7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e";
const NOW = new Date("2026-11-18T18:00:00Z");
const T = "2026-11-18T15:00:00.123456+00:00";

const SETTINGS: AdsSettings = { ...ADS_SETTINGS_UNSET, limits: { ...ADS_SETTINGS_UNSET.limits, monthly_cap_cents: { meta: 300_000 } } };
const val = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;
const has = (q: RecordedQuery, method: string) => q.ops.some((o) => o.method === method);

const campaigns = [
  { id: LIVE, name: "CDL-A Dallas", state: "live", state_changed_at: "2026-11-02T00:00:00Z", connection_id: META, daily_budget_cents: 5_000, lifetime_cap_cents: null },
  { id: REVIEW, name: "CDL-A Tulsa", state: "review", state_changed_at: "2026-11-17T00:00:00Z", connection_id: META, daily_budget_cents: null, lifetime_cap_cents: null },
  { id: PAUSED_BY_DANA, name: "Owner-ops", state: "paused", state_changed_at: "2026-11-10T00:00:00Z", connection_id: META, daily_budget_cents: 3_000, lifetime_cap_cents: null },
  { id: PAUSED_BY_RULE, name: "Flatbed", state: "paused", state_changed_at: "2026-11-12T00:00:00Z", connection_id: META, daily_budget_cents: 3_000, lifetime_cap_cents: null },
];
const hours: Record<string, unknown[]> = {
  [LIVE]: [{ campaign_id: LIVE, hour: "2026-11-10T15:00:00+00:00", spend_cents: 6_000, impressions: 1, clicks: 1, leads: 3 }],
  [PAUSED_BY_RULE]: [{ campaign_id: PAUSED_BY_RULE, hour: "2026-11-11T15:00:00+00:00", spend_cents: 3_000, impressions: 1, clicks: 1, leads: 1 }],
};
const transitions: Record<string, unknown[]> = {
  [PAUSED_BY_DANA]: [
    { request: { event: "paused" }, actor_kind: "agent", actor_name: "Orchestrator", cause: null, started_at: "2026-11-10T00:00:00Z" },
    { request: { event: "pause" }, actor_kind: "person", actor_name: "Dana", cause: "Hiring paused", started_at: "2026-11-09T23:59:00Z" },
  ],
  [PAUSED_BY_RULE]: [
    { request: { event: "paused" }, actor_kind: "agent", actor_name: "Orchestrator", cause: null, started_at: "2026-11-12T00:00:00Z" },
    { request: { event: "pause" }, actor_kind: "agent", actor_name: "Monitor", cause: "cost per lead over the cap", started_at: "2026-11-11T23:59:00Z" },
  ],
};

function action(i: number, campaign_id: string | null = LIVE) {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, kind: "transition", status: "succeeded", actor_kind: "agent", actor_name: "Orchestrator",
    campaign_id, cause: null, error_code: null, request: { from: "launching", event: "launched" }, started_at: T, finished_at: T,
  };
}

function db(ledger: unknown[] = [action(1), action(2, OLD)]) {
  return createSupabaseRecorder({
    tables: {
      ads_settings_versions: [{ id: "v1", version: 3, settings: SETTINGS, kill_switch: false, kill_reason: null, created_at: T, created_by_name: "Owner" }],
      ads_platform_connections: (q) => {
        const all = [{ id: META, provider: "meta", is_sandbox: false, status: "connected", last_test_at: T, last_error: null, last_test: null }];
        return val(q, "provider") ? all.filter((c) => c.provider === val(q, "provider")) : all;
      },
      ads_campaigns: (q) => {
        const ids = val(q, "id") as string[] | undefined;
        if (ids) return ids.includes(OLD) ? [{ id: OLD, name: "Archived in October" }] : [];
        const conns = val(q, "connection_id") as string[] | undefined;
        const states = val(q, "state") as string[] | string | undefined;
        if (conns) return campaigns;
        if (Array.isArray(states)) return campaigns.filter((c) => states.includes(c.state));
        return campaigns;
      },
      ads_spend_hourly: (q) => {
        const rows = (hours[val(q, "campaign_id") as string] ?? []) as Array<{ hour: string }>;
        const range = q.ops.find((o) => o.method === "range")?.args as [number, number] | undefined;
        return range ? rows.slice(range[0], range[1] + 1) : rows;
      },
      ads_creatives: (q) => ({ data: [], count: val(q, "campaign_id") === REVIEW && val(q, "state") === "ready" ? 2 : 0 }),
      ads_actions: (q) => {
        if (val(q, "kind") === "transition" && val(q, "campaign_id")) return transitions[val(q, "campaign_id") as string] ?? [];
        if (val(q, "kind") === "external_change") return { data: [], count: 0 };
        return ledger;
      },
      ad_generations: [],
      jobs: [],
    },
  });
}

describe("adsOverviewView", () => {
  it("month spend and leads match the spend read: the guard's platform month, and the hourly leads", async () => {
    const rec = db();
    const [v, spend] = await Promise.all([adsOverviewView(rec.client, ORG, NOW), adsSpendView(db().client, ORG, NOW)]);
    expect(v.totals).toEqual({ running: 1, month_spend_cents: 9_000, month_leads: 4, month_cost_per_lead_cents: 2_250 });
    expect(v.totals.month_spend_cents).toBe(spend.platforms.reduce((n, p) => n + p.month_to_date_cents, 0));
    expect(v.campaigns.find((c) => c.id === LIVE)).toMatchObject({ platform: "meta", month_spend_cents: 6_000, month_leads: 3 });
    expect(v.campaigns.find((c) => c.id === REVIEW)).toMatchObject({ platform: null, month_spend_cents: 0 });
  });

  it("Needs you: the ads waiting for review and a rule's pause; a person's pause is not listed", async () => {
    const v = await adsOverviewView(db().client, ORG, NOW);
    expect(v.needs_you.map((i) => [i.kind, i.campaign_id, i.detail])).toEqual([
      ["paused_not_by_person", PAUSED_BY_RULE, "Paused by Monitor: cost per lead over the cap"],
      ["ads_review", REVIEW, "2 ads ready for your review."],
    ]);
  });

  it("the ledger names a campaign the open list does not hold, and an archived one, by reading it", async () => {
    const rec = db();
    const v = await adsOverviewView(rec.client, ORG, NOW);
    expect(v.ledger.entries.map((e) => [e.campaign_name, e.event])).toEqual([["CDL-A Dallas", "launched"], ["Archived in October", "launched"]]);
    expect(v.ledger).toMatchObject({ older: null, newer: null });
    expect(rec.forTable("ads_campaigns").find((q) => val(q, "id"))!.filters()).toContainEqual(expect.objectContaining({ col: "org_id", val: ORG }));
  });

  it("a full newest page hands back its last row as `older`; the older read starts below it, newest first", async () => {
    const many = Array.from({ length: OVERVIEW_LEDGER_PAGE + 1 }, (_, i) => action(i + 1));
    const v = await adsOverviewView(db(many).client, ORG, NOW);
    expect(v.ledger.entries).toHaveLength(OVERVIEW_LEDGER_PAGE);
    expect(v.ledger.newer).toBeNull();
    const cursor = parseLedgerCursor(v.ledger.older!)!;
    expect(cursor).toEqual({ started_at: T, id: many[OVERVIEW_LEDGER_PAGE - 1]!.id });

    const next = db(many);
    const older = await adsOverviewView(next.client, ORG, NOW, { kind: "before", at: cursor });
    const page = next.forTable("ads_actions").find((q) => has(q, "or"))!;
    expect(page.ops.find((o) => o.method === "or")!.args[0]).toBe(`started_at.lt."${T}",and(started_at.eq."${T}",id.lt.${cursor.id})`);
    expect(page.ops.filter((o) => o.method === "order").map((o) => [o.args[0], (o.args[1] as { ascending: boolean }).ascending])).toEqual([["started_at", false], ["id", false]]);
    // Reading older, the newer side always exists: the cursor's own row is there.
    expect(older.ledger.newer).not.toBeNull();
  });

  it("a newer read walks up from the cursor, keeps the rows nearest it, and answers them newest first", async () => {
    const cursor = { started_at: T, id: "00000000-0000-4000-8000-000000000000" };
    // Ascending from the cursor, as the database answers the read: 51 rows, the 51st the farthest from the cursor.
    const ascending = Array.from({ length: OVERVIEW_LEDGER_PAGE + 1 }, (_, i) => action(i + 1));
    const rec = db(ascending);
    const v = await adsOverviewView(rec.client, ORG, NOW, { kind: "after", at: cursor });
    const page = rec.forTable("ads_actions").find((q) => has(q, "or"))!;
    expect(page.ops.find((o) => o.method === "or")!.args[0]).toBe(`started_at.gt."${T}",and(started_at.eq."${T}",id.gt.${cursor.id})`);
    expect(page.ops.filter((o) => o.method === "order").map((o) => (o.args[1] as { ascending: boolean }).ascending)).toEqual([true, true]);
    expect(v.ledger.entries.map((e) => e.id)).toEqual(ascending.slice(0, OVERVIEW_LEDGER_PAGE).map((a) => a.id).reverse());
    expect(v.ledger.newer).toBe(`${T}|${ascending[OVERVIEW_LEDGER_PAGE - 1]!.id}`);
    expect(v.ledger.older).toBe(`${T}|${ascending[0]!.id}`);
  });

  it("every read is scoped to the caller's org, and nothing is written", async () => {
    const rec = db();
    await adsOverviewView(rec.client, ORG, NOW);
    expectOrgScoped(rec, ORG);
    expect(rec.writes()).toEqual([]);
  });
});
