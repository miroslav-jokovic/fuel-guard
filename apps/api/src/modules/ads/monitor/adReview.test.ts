import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_USER, campaign, CONN, createAdsWorld, ORG, type AdsWorld } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { adReviewKey } from "./adReview.js";
import { reconcileConnection } from "./reconcile.js";

/**
 * ADS-RUNBOOK Gap 3 (monitor-alerts, 2026-11-06): a Meta-rejected ad is detected, through the real reconcile over
 * the simulator. Our objects on Meta agree with our rows (so reconcile's own mismatches stay out of the way); only
 * the ad's review verdict differs (`FakeMeta.reviewAd`).
 */

const connection = { id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, page_token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" };
const REFS = { meta_campaign_id: "600", meta_adset_id: "601", meta_ad_ids: ["602", "603"] };

let fake: FakeMeta;
let w: AdsWorld;
const world = (state: Parameters<typeof campaign>[1] = "live") => {
  w = createAdsWorld({ campaigns: [campaign("c1", state, { platform_refs: REFS, daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 })], connections: [connection] });
};
beforeEach(async () => {
  resetGraphThrottles();
  fake = await simulatorFakeForTests();
  fake.campaigns.set("600", { id: "600", account_id: SIMULATOR_ACCOUNT_ID, name: "S360|SIM|campaign|c1", objective: "OUTCOME_LEADS", status: "ACTIVE", special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"], spend_cap: "50000", daily_budget: null });
  fake.sets.adsets.set("601", { id: "601", account_id: SIMULATOR_ACCOUNT_ID, campaign_id: "600", name: "S360|SIM|adset|c1", status: "ACTIVE", daily_budget: "5000", billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: "1" }, targeting: {} });
  for (const id of ["602", "603"]) fake.sets.ads.set(id, { id, adset_id: "601", name: `S360|SIM|ad|${id}`, status: "ACTIVE" });
  world();
});
afterEach(async () => stopSimulatorForTests());

const run = () => reconcileConnection({ admin: w.admin, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: w.now }, ORG, CONN);
const reviewRows = () => w.actions.filter((a) => a.kind === "external_change" && (a.request as { field?: string }).field === "review");
const rejectedBells = () => w.bell.filter((b) => b.category === "ads_rejected");
const metaWrites = (from: number) => fake.requests.slice(from).filter((q) => q.method === "POST").length;

describe("a Meta-rejected ad is detected (ADS-RUNBOOK Gap 3)", () => {
  it("DISAPPROVED: one external_change row keyed on the ad and status, with Meta's reasons, and one critical 'ads_rejected' bell", async () => {
    fake.reviewAd("603", { effective_status: "DISAPPROVED", reasons: { "Employment ads": "Your ad mentions an age requirement." } });
    const before = fake.requests.length;
    const out = await run();
    expect(out.ad_review).toMatchObject({ read: 2, recorded: [{ ad_id: "603", status: "DISAPPROVED" }], already_recorded: 0, failures: [] });
    expect(reviewRows()).toEqual([expect.objectContaining({
      campaign_id: "c1", actor_kind: "platform", status: "succeeded", idempotency_key: adReviewKey(CONN, "603", "DISAPPROVED"),
      request: { level: "ad", meta_id: "603", field: "review", theirs: "DISAPPROVED", reasons: ["Your ad mentions an age requirement."] },
    })]);
    expect(rejectedBells()).toEqual([{ user: ADMIN_USER, category: "ads_rejected", title: "Meta turned down an ad", severity: "critical", dedupe: `ads_rejected:${CONN}:603:DISAPPROVED` }]);
    // Reconcile still never writes to Meta.
    expect(metaWrites(before)).toBe(0);
    expectOrgScoped(w.rec, ORG, { exempt: ["memberships"] });
  });

  it("WITH_ISSUES is a warning, under its own key", async () => {
    fake.reviewAd("602", { effective_status: "WITH_ISSUES" });
    await run();
    expect(rejectedBells()).toEqual([expect.objectContaining({ title: "Meta found a problem with an ad", severity: "warning", dedupe: `ads_rejected:${CONN}:602:WITH_ISSUES` })]);
    expect(reviewRows()).toHaveLength(1);
  });

  it("the same verdict on the next run is already recorded: no second row, no second bell", async () => {
    fake.reviewAd("603", { effective_status: "DISAPPROVED" });
    await run();
    const again = await run();
    expect(again.ad_review).toMatchObject({ recorded: [], already_recorded: 1 });
    expect(reviewRows()).toHaveLength(1);
    expect(rejectedBells()).toHaveLength(1);
  });

  it("a new verdict on the same ad is a new fact: WITH_ISSUES after DISAPPROVED is a second row and bell", async () => {
    fake.reviewAd("603", { effective_status: "DISAPPROVED" });
    await run();
    fake.reviewAd("603", { effective_status: "WITH_ISSUES" });
    await run();
    expect(reviewRows().map((r) => (r.request as { theirs: string }).theirs)).toEqual(["DISAPPROVED", "WITH_ISSUES"]);
    expect(rejectedBells()).toHaveLength(2);
  });

  it("an approved ad, and a campaign that is not delivering, ring nothing", async () => {
    expect((await run()).ad_review).toMatchObject({ read: 2, recorded: [] });
    world("paused");
    fake.reviewAd("603", { effective_status: "DISAPPROVED" });
    expect((await run()).ad_review).toMatchObject({ read: 0, recorded: [] });
    expect(reviewRows()).toEqual([]);
    expect(rejectedBells()).toEqual([]);
  });

  it("an ad read that fails is a failure of the run, not a green pass", async () => {
    // A refusal the client does not retry (a transient one is retried with real backoff), on this ad only.
    fake.inject("GET", /^603$/, { kind: "token_expired" });
    const out = await run();
    expect(out.failures).toEqual(expect.arrayContaining([{ campaign_id: "c1", reason: "ad_review:graph:token_invalid" }]));
    expect(out.ad_review).toMatchObject({ read: 1 });
    expect(rejectedBells()).toEqual([]);
  });
});
