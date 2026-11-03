import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_USER, campaign, CONN, createAdsWorld, ORG, type WorldCampaign } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { forgetAllHours } from "../platforms/simulator/fakeMetaInsightsHourly.js";
import { reconcileConnection } from "./reconcile.js";

/**
 * B5c over the real pieces: the stateful ads world (whose `ads_actions` holds 0537's unique idempotency key,
 * so "once per fact" is the ledger's answer here as in production) and the simulator over HTTP, edited the
 * way a person in Ads Manager would edit it (`externalStatusChange`, a budget set by hand). The handoff's
 * tests: an Ads-Manager status change → exactly one `external_change`; a run with no changes flags nothing.
 */

const SIM_CONN = { id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" };
let fake: FakeMeta;
let n = 0;

/** One campaign of ours at Meta that agrees with our row: campaign + ad set, amounts as approved. */
function onMeta(id: string, state: WorldCampaign["state"]): WorldCampaign {
  const mc = String(660_000_000_000 + ++n);
  const ms = String(670_000_000_000 + n);
  const status = state === "live" ? "ACTIVE" : "PAUSED";
  fake.campaigns.set(mc, { id: mc, account_id: SIMULATOR_ACCOUNT_ID, name: `S360|SIM|campaign|recruiting_opening|op-${n}@v1|ALL|20261102|ab12cd3${n % 10}`, objective: "OUTCOME_LEADS", status, special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"], spend_cap: "50000", daily_budget: null });
  fake.adsets.set(ms, { id: ms, account_id: SIMULATOR_ACCOUNT_ID, campaign_id: mc, name: `S360|SIM|adset|${id}`, status: "ACTIVE", daily_budget: "5000", billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", destination_type: null, promoted_object: null, targeting: {} });
  return campaign(id, state, { platform_refs: { meta_campaign_id: mc, meta_adset_id: ms } });
}
const metaOf = (c: WorldCampaign) => c.platform_refs as { meta_campaign_id: string; meta_adset_id: string };
const world = (campaigns: WorldCampaign[]) => createAdsWorld({ campaigns, connections: [SIM_CONN] });
const run = (w: ReturnType<typeof world>) => reconcileConnection({ admin: w.admin, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: w.now }, ORG, CONN);
const changes = (w: ReturnType<typeof world>) => w.actions.filter((a) => a.kind === "external_change");

beforeAll(async () => {
  fake = await simulatorFakeForTests();
});
afterAll(async () => stopSimulatorForTests());
beforeEach(() => {
  resetGraphThrottles();
  forgetAllHours(fake);
  fake.campaigns.clear();
  fake.adsets.clear();
  fake.requests.length = 0;
});

describe("the daily reconcile: Meta against our rows, every edit once, nothing adopted (B5c)", () => {
  it("a run with no changes flags nothing, writes nothing, rings nothing", async () => {
    const w = world([onMeta("c1", "live"), onMeta("c2", "paused")]);
    const r = await run(w);
    expect([r.compared, r.recorded, r.failures, changes(w), w.bell]).toEqual([2, [], [], [], []]);
    expectOrgScoped(w.rec, ORG);
  });

  it("an Ads-Manager status change → exactly one external_change, by the platform, and one critical bell — and the next run adds none", async () => {
    const c2 = onMeta("c2", "paused");
    const w = world([onMeta("c1", "live"), c2]);
    fake.externalStatusChange(metaOf(c2).meta_campaign_id, "ACTIVE");
    const r = await run(w);
    expect(r.recorded).toEqual([{ field: "status", meta_id: metaOf(c2).meta_campaign_id }]);
    expect(changes(w).map((a) => [a.campaign_id, a.actor_kind, a.actor_name, a.status, a.idempotency_key])).toEqual([
      ["c2", "platform", "Meta (reconcile)", "succeeded", `external_change:${CONN}:campaign:${metaOf(c2).meta_campaign_id}:status:ACTIVE`],
    ]);
    expect(w.bell.map((b) => [b.user, b.category, b.severity, b.title])).toEqual([[ADMIN_USER, "ads_external_change", "critical", "A campaign had its status changed"]]);
    const again = await run(w);
    expect([again.recorded, again.already_recorded, changes(w).length, w.bell.length]).toEqual([[], 1, 1, 1]);
  });

  it("never adopts: our campaign's state, budget and Meta's object are exactly as they were", async () => {
    const c2 = onMeta("c2", "paused");
    const w = world([c2]);
    fake.externalStatusChange(metaOf(c2).meta_campaign_id, "ACTIVE");
    fake.adsets.get(metaOf(c2).meta_adset_id)!.daily_budget = "9000";
    await run(w);
    expect([w.byId("c2").state, w.byId("c2").daily_budget_cents, w.transitions("c2")]).toEqual(["paused", 5_000, []]);
    expect([fake.campaigns.get(metaOf(c2).meta_campaign_id)!.status, fake.adsets.get(metaOf(c2).meta_adset_id)!.daily_budget]).toEqual(["ACTIVE", "9000"]);
    expect(fake.requests.filter((q) => q.method === "POST")).toEqual([]);
  });

  it("a budget changed twice is two facts; the same value standing is one", async () => {
    const c1 = onMeta("c1", "live");
    const w = world([c1]);
    const set = fake.adsets.get(metaOf(c1).meta_adset_id)!;
    set.daily_budget = "6000";
    await run(w);
    await run(w);
    set.daily_budget = "7000";
    await run(w);
    expect(changes(w).map((a) => (a.request as { theirs: number }).theirs)).toEqual([6_000, 7_000]);
  });

  it("a campaign made in Ads Manager is reported once as not ours; a deleted one of ours as missing", async () => {
    const c1 = onMeta("c1", "live");
    const w = world([c1]);
    fake.campaigns.set("999000000001", { id: "999000000001", account_id: SIMULATOR_ACCOUNT_ID, name: "Spring push (manual)", objective: null, status: "ACTIVE", special_ad_categories: [], special_ad_category_country: null, spend_cap: null, daily_budget: null });
    fake.campaigns.delete(metaOf(c1).meta_campaign_id);
    const r = await run(w);
    expect(r.recorded.map((x) => x.field).sort()).toEqual(["missing", "not_ours"]);
    expect(changes(w).find((a) => (a.request as { field: string }).field === "not_ours")!.campaign_id).toBeNull();
  });

  it("a read Meta refuses for another reason is reported and left out — never called missing", async () => {
    const c1 = onMeta("c1", "live");
    const w = world([c1]);
    fake.inject("GET", new RegExp(`^${metaOf(c1).meta_campaign_id}$`), { kind: "token_expired" }, 1);
    const r = await run(w);
    expect([r.compared, r.recorded, r.failures]).toEqual([0, [], [{ campaign_id: "c1", reason: "graph:token_invalid" }]]);
  });

  it("re-reads 28 days of insights before comparing, so the overrun is judged on Meta's settled numbers", async () => {
    const w = world([onMeta("c1", "live")]);
    const r = await run(w);
    expect([r.insights?.days.length, r.insights?.days[0]]).toEqual([28, "2026-10-06"]);
  });
});
