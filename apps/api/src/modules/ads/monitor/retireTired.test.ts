import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADS_CREATIVE_REFRESH_DEFAULT, type AdsCreativeRefresh, type AdsSettings } from "@silvicom/shared";
import { ADMIN_USER, campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type WorldCampaign } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { retireTiredAds } from "./retireTired.js";

/**
 * Retiring a tired ad (CQ9b, D-AD23): the real adapter against FakeMeta, the ads world's ledger and bell, the per-ad
 * hours as rows. One ad tires, the other does not; the campaign stays live; the switch decides only the call.
 */
const ON: AdsCreativeRefresh = { ...ADS_CREATIVE_REFRESH_DEFAULT, retire: true };
const SETTINGS: AdsSettings = { ...LIVE_SETTINGS, creative_refresh: ON };
const SIM_CONN = { id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" };
const CR_TIRED = "00000000-0000-4000-8000-00000000cc01";
const CR_FRESH = "00000000-0000-4000-8000-00000000cc02";
const AD_TIRED = "880000000011";
const AD_FRESH = "880000000012";
let fake: FakeMeta;

/** The world's clock starts 2026-11-02T12:00Z; the ads were born 20 days before, so both windows are full. */
const BORN = Date.parse("2026-10-13T12:00:00Z");
function hours(adId: string, creativeId: string, ctr: (day: number) => number) {
  return Array.from({ length: 20 }, (_, d) => ({
    org_id: ORG, campaign_id: "c1", creative_id: creativeId, language: "en", meta_ad_id: adId,
    hour: new Date(BORN + d * 86_400_000).toISOString(), impressions: 1000, clicks: Math.round(1000 * ctr(d)), leads: 0, currency: "USD", spend_cents: 100,
  }));
}
const tired = (d: number) => (d < 7 ? 0.02 : 0.01);
const fresh = () => 0.02;

function onMeta(): WorldCampaign {
  fake.campaigns.set("771", { id: "771", account_id: SIMULATOR_ACCOUNT_ID, name: "S360|c1", objective: "OUTCOME_LEADS", status: "ACTIVE", special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"], spend_cap: "50000", daily_budget: null });
  fake.sets.adsets.set("881", { id: "881", account_id: SIMULATOR_ACCOUNT_ID, campaign_id: "771", name: "S360|a", status: "ACTIVE", daily_budget: "5000", billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: "1" }, targeting: {} });
  fake.sets.ads.set(AD_TIRED, { id: AD_TIRED, adset_id: "881", name: "S360|ad|EN", status: "ACTIVE" });
  fake.sets.ads.set(AD_FRESH, { id: AD_FRESH, adset_id: "881", name: "S360|ad2|EN", status: "ACTIVE" });
  return campaign("c1", "live", {
    platform_refs: {
      meta_campaign_id: "771", meta_adset_id: "881", meta_ad_ids: [AD_TIRED, AD_FRESH],
      ads: [{ creative_id: CR_TIRED, language: "en", meta_ad_id: AD_TIRED }, { creative_id: CR_FRESH, language: "en", meta_ad_id: AD_FRESH }],
    },
  });
}
function world(settings: AdsSettings = SETTINGS, adHours = [...hours(AD_TIRED, CR_TIRED, tired), ...hours(AD_FRESH, CR_FRESH, fresh)]) {
  return createAdsWorld({
    campaigns: [onMeta()], settings, connections: [SIM_CONN],
    extraTables: { ads_ad_spend_hourly: adHours, ads_creatives: [{ id: CR_TIRED, org_id: ORG, campaign_id: "c1", platform_status: null }, { id: CR_FRESH, org_id: ORG, campaign_id: "c1", platform_status: null }] },
  });
}
const run = (w: ReturnType<typeof world>, override?: AdsCreativeRefresh) => retireTiredAds({ admin: w.admin, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: w.now }, ORG, CONN, override);

beforeAll(async () => { fake = await simulatorFakeForTests(); });
afterAll(async () => stopSimulatorForTests());
beforeEach(() => { resetGraphThrottles(); fake.requests.length = 0; });

describe("retireTiredAds — one ad paused at the platform, the campaign kept running (CQ9b)", () => {
  it("the tired ad is paused at Meta, ledgered as retire_ad with its reason, marked retired on its creative, and rung once; the fresh ad and the campaign are untouched", async () => {
    const w = world();
    const r = await run(w);
    expect([r.campaigns, r.ads, r.failures]).toEqual([1, 2, []]);
    expect(r.verdicts.map((v) => [v.meta_ad_id, v.verdict.kind, v.acted])).toEqual([[AD_TIRED, "retire", "retired"], [AD_FRESH, "hold", "not_tired"]]);
    expect([fake.sets.ads.get(AD_TIRED)!.status, fake.sets.ads.get(AD_FRESH)!.status, fake.campaigns.get("771")!.status]).toEqual(["PAUSED", "ACTIVE", "ACTIVE"]);
    expect(w.byId("c1").state).toBe("live");
    const act = w.actions.find((a) => a.kind === "retire_ad")!;
    expect(act).toMatchObject({ campaign_id: "c1", creative_id: CR_TIRED, actor_kind: "agent", actor_name: "monitor", status: "succeeded", idempotency_key: `retire_ad:c1:${AD_TIRED}` });
    expect(String(act.cause)).toContain("fell 50 %");
    const marked = w.rec.writes().filter((q) => q.table === "ads_creatives");
    expect(marked.map((q) => [q.write!.payload as object, q.filters().find((f) => f.col === "id")?.val])).toEqual([[expect.objectContaining({ platform_status: "retired" }), CR_TIRED]]);
    expect(w.bell).toEqual([{ user: ADMIN_USER, category: "ads_creative_retired", title: "An ad was retired: it had tired", severity: "warning", dedupe: `ads_creative_retired:c1:${AD_TIRED}` }]);
    expectOrgScoped(w.rec, ORG);
  });

  it("the next run finds the ledger row and does nothing again: one pause call, one row, one bell", async () => {
    const w = world();
    await run(w);
    const posts = () => fake.requests.filter((q) => q.method === "POST" && q.path.endsWith(AD_TIRED)).length;
    const after = posts();
    const again = await run(w);
    expect(again.verdicts[0]!.acted).toBe("already");
    expect([posts(), w.actions.filter((a) => a.kind === "retire_ad").length, w.bell.length]).toEqual([after, 1, 1]);
  });

  it("with the switch off, the verdict is computed and reported and nothing is called, written or rung", async () => {
    const w = world({ ...LIVE_SETTINGS, creative_refresh: { ...ON, retire: false } });
    const r = await run(w);
    expect(r.verdicts[0]).toMatchObject({ meta_ad_id: AD_TIRED, verdict: { kind: "retire" }, acted: "switch_off" });
    expect([fake.sets.ads.get(AD_TIRED)!.status, w.actions.length, w.bell.length]).toEqual(["ACTIVE", 0, 0]);
  });

  it("a platform refusal is a failed ledger row and a failure, never a mark or a bell", async () => {
    const w = world();
    fake.sets.ads.delete(AD_TIRED);
    const r = await run(w);
    expect(r.verdicts[0]!.acted).toBe("refused");
    expect(r.failures.length).toBe(1);
    expect(w.actions.find((a) => a.kind === "retire_ad")!.status).toBe("failed");
    expect([w.rec.writes().filter((q) => q.table === "ads_creatives").length, w.bell.length]).toEqual([0, 0]);
  });

  it("a campaign that is not live is not judged", async () => {
    const w = createAdsWorld({ campaigns: [{ ...onMeta(), state: "paused" }], settings: SETTINGS, connections: [SIM_CONN], extraTables: { ads_ad_spend_hourly: hours(AD_TIRED, CR_TIRED, tired), ads_creatives: [] } });
    expect(await run(w)).toMatchObject({ campaigns: 0, ads: 0, verdicts: [] });
  });
});
