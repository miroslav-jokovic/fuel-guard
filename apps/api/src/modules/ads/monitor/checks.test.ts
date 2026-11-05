import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdsSettings } from "@silvicom/shared";
import { ADMIN_USER, campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type WorldCampaign } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { forgetAllHours, plantFrequency } from "../platforms/simulator/fakeMetaInsightsHourly.js";
import { checkConnection } from "./checks.js";

/**
 * B5b over the real pieces: the stateful ads world (the campaign machine's compare-and-set, the ledger, the
 * bell's dedupe) and the simulator over HTTP for what only Meta knows (learning stage, frequency, the
 * account's month). The handoff's tests: a forced overspend → pause requested and `ads_overspend`; zero-lead
 * spend past the minimum fires; a learning-phase ad set is not paused except by a cap; every query org-scoped.
 */

const ZONE = "America/Chicago";
// The world's clock starts at 2026-11-02T12:00Z — 06:00 on 11-02 in Chicago (CST since the 11-01 fall-back).
const SETTINGS: AdsSettings = {
  ...LIVE_SETTINGS,
  limits: { ...LIVE_SETTINGS.limits, monthly_cap_cents: { simulator: 300_000 } },
  auto_pause: { cpl_max_cents: 4_200, cpl_min_leads: 3, no_lead_spend_cents: 7_500, frequency_max: 4, pause_at_daily_cap: true, pause_when_filled: true },
};
const SIM_CONN = { id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" };

let fake: FakeMeta;
let n = 0;

/** A campaign of ours with an ad set at Meta in the given learning stage (absent = Meta returns none). */
function onMeta(id: string, stage: "LEARNING" | "SUCCESS" | "FAIL" | null, patch: Partial<WorldCampaign> = {}): WorldCampaign {
  const adset = String(880_000_000_000 + ++n);
  fake.adsets.set(adset, {
    id: adset, account_id: SIMULATOR_ACCOUNT_ID, campaign_id: "x", name: `S360|SIM|adset|${id}`, status: "ACTIVE", daily_budget: "5000",
    billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", destination_type: null, promoted_object: null, targeting: {},
    ...(stage ? { learning_stage_info: { status: stage } } : {}),
  });
  return campaign(id, "live", { platform_refs: { meta_campaign_id: `77${n}`, meta_adset_id: adset }, ...patch });
}
const hour = (campaignId: string, at: string, spend_cents: number, leads = 0) => ({ org_id: ORG, campaign_id: campaignId, hour: at, spend_cents, impressions: 100, clicks: 1, leads, currency: "USD" });

function world(campaigns: WorldCampaign[], spend: ReturnType<typeof hour>[] = []) {
  return createAdsWorld({ campaigns, spend, settings: SETTINGS, connections: [SIM_CONN] });
}
const run = (w: ReturnType<typeof world>) => checkConnection({ admin: w.admin, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: w.now }, ORG, CONN, ZONE);
const adsetOf = (c: WorldCampaign) => (c.platform_refs as { meta_adset_id: string }).meta_adset_id;

beforeAll(async () => {
  fake = await simulatorFakeForTests();
});
afterAll(async () => stopSimulatorForTests());
beforeEach(() => {
  resetGraphThrottles();
  forgetAllHours(fake);
  fake.accounts.get(SIMULATOR_ACCOUNT_ID)!.month_spend_cents = 0;
  fake.requests.length = 0;
});

describe("the monitor's checks pause through the machine and ring the bell (B5b)", () => {
  it("a forced overspend: today past the daily budget → the agent's `pause`, ledgered with its rule, and one critical ads_overspend", async () => {
    const c1 = onMeta("c1", "SUCCESS");
    const w = world([c1], [hour("c1", "2026-11-02T06:00:00Z", 3_000), hour("c1", "2026-11-02T07:00:00Z", 2_001)]);
    const r = await run(w);
    expect([r.checked, r.paused, r.failures]).toEqual([1, [{ campaign_id: "c1", rule: "daily_cap" }], []]);
    expect(w.byId("c1").state).toBe("pausing");
    expect(w.transitions("c1").map((a) => [a.actor_kind, a.actor_name, (a.request as { event: string }).event, a.status])).toEqual([["agent", "monitor", "pause", "succeeded"]]);
    expect(JSON.stringify(w.transitions("c1")[0])).toContain("auto-pause daily_cap: measured 5001 > 5000");
    expect(w.bell).toEqual([{ user: ADMIN_USER, category: "ads_overspend", title: "An ad was paused at its daily cap", severity: "critical", dedupe: "ads_overspend:c1:daily_cap:2026-11-02" }]);
    expectOrgScoped(w.rec, ORG);
  });

  it("the next run leaves a pausing campaign alone: one pause, one bell", async () => {
    const w = world([onMeta("c1", "SUCCESS")], [hour("c1", "2026-11-02T07:00:00Z", 6_000)]);
    await run(w);
    const again = await run(w);
    expect([again.checked, again.paused, w.transitions("c1").length, w.bell.length]).toEqual([0, [], 1, 1]);
  });

  it("'today' is the account's day: last night's spend in UTC's today does not count toward it", async () => {
    // 05:00Z on 11-02 is 23:00 on 11-01 in Chicago.
    const w = world([onMeta("c1", "SUCCESS")], [hour("c1", "2026-11-02T05:00:00Z", 4_000, 1), hour("c1", "2026-11-02T07:00:00Z", 2_000)]);
    expect((await run(w)).paused).toEqual([]);
  });

  it("the month past the cap on Meta's own figure pauses every delivering campaign on the connection", async () => {
    fake.accounts.get(SIMULATOR_ACCOUNT_ID)!.month_spend_cents = 300_001;
    const w = world([onMeta("c1", "LEARNING"), onMeta("c2", "SUCCESS"), onMeta("c3", "SUCCESS", { state: "paused" })]);
    const r = await run(w);
    expect(r.paused).toEqual([{ campaign_id: "c1", rule: "monthly_cap" }, { campaign_id: "c2", rule: "monthly_cap" }]);
    expect([w.byId("c1").state, w.byId("c2").state, w.byId("c3").state]).toEqual(["pausing", "pausing", "paused"]);
    expect(w.bell.map((b) => b.category)).toEqual(["ads_overspend", "ads_overspend"]);
    // The monitor decides; the orchestrator's pausing step is the one that writes to Meta (A5, B5b header).
    expect(fake.requests.filter((q) => q.method === "POST")).toEqual([]);
  });

  it("zero-lead spend past the minimum pauses with ads_no_leads — but not while Meta is still learning", async () => {
    const spend = (id: string) => [hour(id, "2026-10-30T15:00:00Z", 7_501)];
    const learning = world([onMeta("c1", "LEARNING")], spend("c1"));
    expect((await run(learning)).paused).toEqual([]);
    expect(learning.byId("c1").state).toBe("live");

    const done = world([onMeta("c1", "FAIL")], spend("c1"));
    expect((await run(done)).paused).toEqual([{ campaign_id: "c1", rule: "no_lead_spend" }]);
    expect(done.bell.map((b) => [b.category, b.severity])).toEqual([["ads_no_leads", "warning"]]);

    // An ad set Meta reports no stage for is judged: the rules must not switch off on such an account.
    const silent = world([onMeta("c1", null)], spend("c1"));
    expect((await run(silent)).paused).toEqual([{ campaign_id: "c1", rule: "no_lead_spend" }]);
  });

  it("fatigue: a 7-day frequency over the setting pauses, ledgered, with no bell (the brief reports it)", async () => {
    const c1 = onMeta("c1", "SUCCESS");
    plantFrequency(fake, adsetOf(c1), 4.5);
    const w = world([c1]);
    expect((await run(w)).paused).toEqual([{ campaign_id: "c1", rule: "frequency_max" }]);
    expect([w.byId("c1").state, w.bell]).toEqual(["pausing", []]);
    const asked = fake.requests.filter((q) => q.path.endsWith(`${adsetOf(c1)}/insights`)).at(-1)!;
    expect(JSON.parse(asked.body.time_range!)).toEqual({ since: "2026-10-27", until: "2026-11-02" });
  });

  it("an ad set that does not exist is settled only by a recorded missing, and a throttle beside the refusal is still a failure (Q-AD35)", async () => {
    const c1 = onMeta("c1", "SUCCESS");
    const set = adsetOf(c1);
    const w = world([c1]);
    fake.adsets.delete(set);
    expect((await run(w)).failures).toEqual([{ campaign_id: "c1", reason: "delivery:stage:meta_100" }]);
    w.actions.push({ id: "a1", org_id: ORG, status: "succeeded", idempotency_key: `external_change:${CONN}:adset:${set}:missing:none` } as never);
    expect((await run(w)).failures).toEqual([]);
    fake.inject("GET", new RegExp(`^${set}/insights$`), { kind: "token_expired" }, 1);
    expect((await run(w)).failures).toEqual([{ campaign_id: "c1", reason: "delivery:stage:meta_100" }]);
    expectOrgScoped(w.rec, ORG);
  });

  it("a learning stage Meta would not give is reported, holds the performance rules, and never holds a cap", async () => {
    const c1 = onMeta("c1", "SUCCESS");
    const c2 = onMeta("c2", "SUCCESS");
    fake.inject("GET", new RegExp(`^(${adsetOf(c1)}|${adsetOf(c2)})$`), { kind: "token_expired" }, 2);
    const w = world([c1, c2], [hour("c1", "2026-10-30T15:00:00Z", 90_000), hour("c2", "2026-11-02T07:00:00Z", 5_001)]);
    const r = await run(w);
    expect(r.paused).toEqual([{ campaign_id: "c2", rule: "daily_cap" }]);
    expect(r.failures.map((f) => [f.campaign_id, f.reason.split(":")[0]])).toEqual([["c1", "delivery"], ["c2", "delivery"]]);
    expect(w.byId("c1").state).toBe("live");
  });
});
