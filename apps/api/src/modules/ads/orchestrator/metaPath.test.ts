import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadEnv } from "../../../env.js";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, T0 } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { runCampaignStep } from "./runner.js";
import { adsWorkers } from "./workers.js";

/**
 * The orchestrator over the REAL platform path (B3): this build's `adsWorkers` → `adapterForConnection`
 * → `metaAdapter` → `MetaGraph` → the in-process simulator (FakeMeta behind `simulatorGate`), with the
 * guard in the middle. Nothing is scripted below the runner: what the campaign ends as on the platform
 * is read from the fake the adapter talked to.
 */
const OWNER = "11111111-1111-4111-8111-111111111111";
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
const SETTINGS = { ...LIVE_SETTINGS, limits: { ...LIVE_SETTINGS.limits, monthly_cap_cents: { meta: 300_000, simulator: 300_000 } } };
const connections = [{ id: CONN, org_id: ORG, provider: "simulator", is_sandbox: false, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" }];
const refs = { meta_campaign_id: "600", meta_adset_id: "601", meta_ad_ids: ["602"] };

let fake: FakeMeta;
beforeEach(async () => {
  resetGraphThrottles();
  fake = await simulatorFakeForTests();
  fake.campaigns.set("600", { id: "600", account_id: SIMULATOR_ACCOUNT_ID, name: "S360|SIM|campaign", objective: "OUTCOME_LEADS", status: "PAUSED", special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"], spend_cap: "50000", daily_budget: null });
  fake.sets.adsets.set("601", { id: "601", account_id: SIMULATOR_ACCOUNT_ID, campaign_id: "600", name: "S360|SIM|adset", status: "PAUSED", daily_budget: "5000", billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: "1" }, targeting: {} });
  fake.sets.ads.set("602", { id: "602", adset_id: "601", name: "S360|SIM|ad", status: "PAUSED" });
});
afterAll(() => stopSimulatorForTests());

describe("orchestrator × the real Meta path on the simulator (B3)", () => {
  it("the kill switch's second half reaches the platform: a live campaign is paused on Meta, with one succeeded pause row", async () => {
    fake.campaigns.get("600")!.status = "ACTIVE";
    const w = createAdsWorld({ campaigns: [campaign("c1", "live", { platform_refs: refs })], kill: true, settings: SETTINGS, connections });
    const deps = { admin: w.admin, now: w.now, workers: adsWorkers({ admin: w.admin, env, now: w.now }) };
    expect(await runCampaignStep(deps, ORG, "c1")).toMatchObject({ kind: "stepped", event: "kill" });
    expect(await runCampaignStep(deps, ORG, "c1")).toMatchObject({ kind: "stepped", event: "paused", result: { kind: "moved", to: "paused" } });
    expect(fake.campaigns.get("600")!.status).toBe("PAUSED");
    expect(w.actions.filter((a) => a.kind === "pause").map((a) => a.status)).toEqual(["succeeded"]);
    expectOrgScoped(w.rec, ORG);
  });

  it("an approved launch goes through the guard to Meta: amounts set, campaign ACTIVE last, the campaign live", async () => {
    const approval = { id: "appr-1", org_id: ORG, campaign_id: "c2", kind: "launch", withdraws_id: null, approved_by: OWNER, approved_by_name: "Owner", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, created_at: T0 };
    const w = createAdsWorld({ campaigns: [campaign("c2", "launching", { platform_refs: refs })], settings: SETTINGS, connections, approvals: [approval] });
    const deps = { admin: w.admin, now: w.now, workers: adsWorkers({ admin: w.admin, env, now: w.now }) };
    expect(await runCampaignStep(deps, ORG, "c2")).toMatchObject({ kind: "stepped", event: "launched", result: { kind: "moved", to: "live" } });
    expect([fake.campaigns.get("600")!.status, fake.sets.adsets.get("601")!.status, fake.sets.ads.get("602")!.status]).toEqual(["ACTIVE", "ACTIVE", "ACTIVE"]);
    expect(w.actions.filter((a) => a.kind === "launch").map((a) => [a.status, a.approval_id])).toEqual([["succeeded", "appr-1"]]);
  });

  it("without an approval the guard refuses and Meta is never asked to activate anything", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c3", "launching", { platform_refs: refs })], settings: SETTINGS, connections });
    const before = fake.requests.length;
    const r = await runCampaignStep({ admin: w.admin, now: w.now, workers: adsWorkers({ admin: w.admin, env, now: w.now }) }, ORG, "c3");
    expect(r).toMatchObject({ kind: "stepped", event: "launch_failed" });
    expect(fake.requests.slice(before).filter((q) => q.method === "POST")).toHaveLength(0);
    expect(fake.campaigns.get("600")!.status).toBe("PAUSED");
  });

  it("a disconnected connection gives no platform: the step fails no_platform rather than guessing", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c4", "pausing", { platform_refs: refs })], settings: SETTINGS, connections: [{ ...connections[0]!, status: "disconnected" }] });
    expect(await runCampaignStep({ admin: w.admin, now: w.now, workers: adsWorkers({ admin: w.admin, env, now: w.now }) }, ORG, "c4")).toMatchObject({ kind: "stepped", event: "pause_failed" });
    expect(w.byId("c4").last_error).toBe("no_platform");
  });
});
