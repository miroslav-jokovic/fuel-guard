import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type WorldCampaign } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { withAuthority } from "../../../testing/withAuthority.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { lowerCampaignBudget } from "../orchestrator/transitions.js";
import { lowerBudget } from "./lowerBudget.js";

/**
 * A person lowers a delivering campaign's daily budget (V5 part 2, Q-APX21): the real door, the real Meta adapter
 * against FakeMeta, the ads world's ledger. What Meta holds is read from the fake the adapter talked to.
 */
const SIM_CONN = { id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" };
const ME = { id: "11111111-1111-4111-8111-111111111111", name: "Dana" };
let fake: FakeMeta;

function onMeta(state: WorldCampaign["state"] = "live", ours = 5_000, meta = "5000"): WorldCampaign {
  fake.campaigns.set("771", { id: "771", account_id: SIMULATOR_ACCOUNT_ID, name: "S360|c1", objective: "OUTCOME_LEADS", status: "ACTIVE", special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"], spend_cap: "50000", daily_budget: null });
  fake.sets.adsets.set("881", { id: "881", account_id: SIMULATOR_ACCOUNT_ID, campaign_id: "771", name: "S360|a", status: "ACTIVE", daily_budget: meta, billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: "1" }, targeting: {} });
  return campaign("c1", state, { daily_budget_cents: ours, lifetime_cap_cents: 50_000, platform_refs: { meta_campaign_id: "771", meta_adset_id: "881", meta_ad_ids: ["990"] } });
}
const world = (c: WorldCampaign = onMeta()) => createAdsWorld({ campaigns: [c], settings: LIVE_SETTINGS, connections: [SIM_CONN] });
const lower = (w: ReturnType<typeof world>, to: number) =>
  lowerBudget({ admin: w.admin, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: w.now }, ORG, ME, "c1", { daily_budget_cents: to, reason: "Too many leads for one recruiter" }, w.now());
const budgetWrites = () => fake.requests.filter((q) => q.method === "POST" && q.path.endsWith("/881")).length;

beforeAll(async () => { fake = await simulatorFakeForTests(); });
afterAll(async () => stopSimulatorForTests());
beforeEach(() => { resetGraphThrottles(); fake.requests.length = 0; });

describe("lowerBudget — a person lowers a running campaign's daily budget (V5, Q-APX21)", () => {
  it("Meta's ad set is lowered and read back, the ledger says who and why, and our row follows", async () => {
    const w = world();
    expect(await lower(w, 3_000)).toEqual({ kind: "lowered", from_cents: 5_000, to_cents: 3_000, recorded: true });
    expect(fake.sets.adsets.get("881")!.daily_budget).toBe("3000");
    expect(w.actions).toEqual([expect.objectContaining({
      kind: "lower_budget", actor_kind: "person", actor_id: ME.id, actor_name: "Dana", status: "succeeded", cause: "Too many leads for one recruiter",
      request: { from_cents: 5_000, to_cents: 3_000 }, idempotency_key: "lower_budget:c1:5000:3000",
    })]);
    expect(w.byId("c1").daily_budget_cents).toBe(3_000);
    expectOrgScoped(w.rec, ORG);
  });

  it("the same lower pressed twice is one lower: one row, one write at Meta", async () => {
    const w = world();
    await lower(w, 3_000);
    w.byId("c1").daily_budget_cents = 5_000; // as read by the second press, before the first's row move was seen
    expect(await lower(w, 3_000)).toMatchObject({ kind: "lowered", recorded: false });
    expect([w.actions.length, budgetWrites()]).toEqual([1, 1]);
  });

  it("an amount not below ours is refused before anything is written or asked", async () => {
    const w = world();
    for (const to of [5_000, 6_000]) expect(await lower(w, to)).toMatchObject({ kind: "refused", refusal: "not_lower" });
    expect([w.actions.length, fake.requests.length]).toEqual([0, 0]);
  });

  it("a budget already lowered in Ads Manager is not raised from our stale copy: Meta's amount is the one compared", async () => {
    const w = world(onMeta("live", 5_000, "2000"));
    expect(await lower(w, 3_000)).toMatchObject({ kind: "refused", refusal: "not_lower" });
    expect(fake.sets.adsets.get("881")!.daily_budget).toBe("2000");
    expect(w.actions).toEqual([expect.objectContaining({ kind: "lower_budget", status: "failed", error_code: "not_lower" })]);
    expect([budgetWrites(), w.byId("c1").daily_budget_cents]).toEqual([0, 5_000]);
  });

  it("Meta answering success and changing nothing is a failure, read back, and our row is not moved", async () => {
    const w = world();
    fake.inject("POST", /^881$/, { kind: "accepted_not_applied" });
    expect(await lower(w, 3_000)).toMatchObject({ kind: "refused", refusal: "platform_refused", detail: "lower_not_applied" });
    expect(fake.sets.adsets.get("881")!.daily_budget).toBe("5000");
    expect(w.actions).toEqual([expect.objectContaining({ status: "failed", error_code: "lower_not_applied" })]);
    expect(w.byId("c1").daily_budget_cents).toBe(5_000);
  });

  it("only a running campaign: a paused one is refused and nothing is asked", async () => {
    const w = world(onMeta("paused"));
    expect(await lower(w, 3_000)).toEqual({ kind: "refused", refusal: "not_live" });
    expect([w.actions.length, fake.requests.length]).toEqual([0, 0]);
  });

  it("the door reads the authority table: with lowering not a person's, nothing is read, written or asked", async () => {
    const w = world();
    expect(await withAuthority("lower_budget", ["agent"], () => lower(w, 3_000))).toEqual({ kind: "refused", refusal: "not_permitted" });
    expect([w.actions.length, fake.requests.length, w.rec.queries.length]).toEqual([0, 0, 0]);
  });

  it("the campaign row's owner will not raise: an amount not below the one it is told is refused, nothing written", async () => {
    const w = world();
    for (const to of [5_000, 6_000, 0]) expect(await lowerCampaignBudget(w.admin, { org_id: ORG, id: "c1" }, 5_000, to)).toBe(false);
    expect([w.rec.writes().length, w.byId("c1").daily_budget_cents]).toEqual([0, 5_000]);
  });

  it("a row that moved since it was read is not overwritten: another amount, or a campaign no longer running", async () => {
    const moved = world();
    expect(await lowerCampaignBudget(moved.admin, { org_id: ORG, id: "c1" }, 4_000, 3_000)).toBe(false);
    expect(moved.byId("c1").daily_budget_cents).toBe(5_000);
    const paused = world(onMeta("paused"));
    expect(await lowerCampaignBudget(paused.admin, { org_id: ORG, id: "c1" }, 5_000, 3_000)).toBe(false);
    expect(paused.byId("c1").daily_budget_cents).toBe(5_000);
  });

  it("another carrier's campaign is not found", async () => {
    const w = world();
    const other = await lowerBudget({ admin: w.admin, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: w.now }, "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", ME, "c1", { daily_budget_cents: 3_000, reason: "x" }, w.now());
    expect(other).toEqual({ kind: "not_found" });
    expect(fake.requests.length).toBe(0);
  });
});
