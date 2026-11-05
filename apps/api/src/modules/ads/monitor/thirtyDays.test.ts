import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdsSettings } from "@silvicom/shared";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type WorldCampaign } from "../../../testing/adsWorld.js";
import { FakeClock } from "../../../testing/fakeClock.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { forgetAllHours, plantFrequency } from "../platforms/simulator/fakeMetaInsightsHourly.js";
import { checkConnection } from "./checks.js";

/**
 * §4R Monitor, L2: "30 simulated days with fatigue, overspend, zero-lead spend". One account, four campaigns,
 * the checks run every day on a moving clock, across the month's end. Each case sits a day at its threshold
 * first, so a rule that fires a day early is as red as one that never fires. The expected days are worked
 * out from the settings below, never read off a run.
 *
 * The spend is written straight to `ads_spend_hourly`: what Meta's numbers do on the way there (late, missing,
 * revised down) is `insightsPull.test.ts`.
 */

const ZONE = "America/Chicago";
const DAYS = 30;
const SETTINGS: AdsSettings = {
  ...LIVE_SETTINGS,
  limits: { ...LIVE_SETTINGS.limits, monthly_cap_cents: { simulator: 300_000 } },
  auto_pause: { cpl_max_cents: 4_200, cpl_min_leads: 3, no_lead_spend_cents: 7_500, frequency_max: 4, pause_at_daily_cap: true, pause_when_filled: true },
};
const SIM_CONN = { id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" };
const DAILY_BUDGET = 5_000;

let fake: FakeMeta;
let n = 0;

function onMeta(id: string, stage: "LEARNING" | "SUCCESS"): { row: WorldCampaign; adset: string } {
  const adset = String(881_000_000_000 + ++n);
  fake.adsets.set(adset, {
    id: adset, account_id: SIMULATOR_ACCOUNT_ID, campaign_id: "x", name: `S360|SIM|adset|${id}`, status: "ACTIVE", daily_budget: String(DAILY_BUDGET),
    billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", destination_type: null, promoted_object: null, targeting: {},
    learning_stage_info: { status: stage },
  });
  return { row: campaign(id, "live", { platform_refs: { meta_campaign_id: `78${n}`, meta_adset_id: adset } }), adset };
}

/** Day 1 is 2026-11-02, so day 30 is 2026-12-01: the run crosses the month's end. */
const dateOf = (day: number) => new Date(Date.UTC(2026, 10, 1 + day)).toISOString().slice(0, 10);

beforeAll(async () => {
  fake = await simulatorFakeForTests();
  forgetAllHours(fake);
  fake.accounts.get(SIMULATOR_ACCOUNT_ID)!.month_spend_cents = 0;
  fake.requests.length = 0;
});
afterAll(async () => stopSimulatorForTests());

describe("thirty days on one account", () => {
  it("each rule pauses its campaign once, on the day it is passed, and a healthy campaign runs the whole month", async () => {
    const healthy = onMeta("healthy", "SUCCESS");
    const fatigued = onMeta("fatigued", "SUCCESS");
    const overspent = onMeta("overspent", "SUCCESS");
    const silent = onMeta("silent", "LEARNING");
    plantFrequency(fake, fatigued.adset, 2);

    const clock = new FakeClock("2026-11-02T12:00:00.000Z");
    const w = createAdsWorld({ campaigns: [healthy.row, fatigued.row, overspent.row, silent.row], settings: SETTINGS, connections: [SIM_CONN], clock: clock.now });
    const spendOn = (id: string, day: number, cents: number, leads: number) => {
      if (w.byId(id).state !== "live") return; // a paused campaign delivers nothing
      w.spend.push({ org_id: ORG, campaign_id: id, hour: `${dateOf(day)}T15:00:00Z`, spend_cents: cents, impressions: 100, clicks: 1, leads, currency: "USD" });
    };

    const pausedOn: Array<[number, string, string]> = [];
    for (let day = 1; day <= DAYS; day += 1) {
      clock.set(`${dateOf(day)}T20:00:00.000Z`);

      // $40 a day at $20 a lead: inside every rule, all month.
      spendOn("healthy", day, 4_000, 2);

      // Frequency climbs to the setting on day 12 (not over it) and past it on day 13.
      spendOn("fatigued", day, 4_000, 2);
      if (day === 12) plantFrequency(fake, fatigued.adset, 4);
      if (day === 13) plantFrequency(fake, fatigued.adset, 4.5);

      // Exactly the daily budget on day 19; a cent over it on day 20.
      spendOn("overspent", day, day === 19 ? DAILY_BUDGET : day === 20 ? DAILY_BUDGET + 1 : 4_000, 2);

      // $30 a day with no lead passes the $75 minimum on day 3, but Meta is learning until day 6.
      spendOn("silent", day, 3_000, 0);
      if (day === 6) fake.adsets.get(silent.adset)!.learning_stage_info = { status: "SUCCESS" };

      resetGraphThrottles();
      const r = await checkConnection({ admin: w.admin, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: w.now }, ORG, CONN, ZONE);
      expect(r.failures).toEqual([]);
      for (const p of r.paused) pausedOn.push([day, p.campaign_id, p.rule]);
    }

    expect(pausedOn).toEqual([[6, "silent", "no_lead_spend"], [13, "fatigued", "frequency_max"], [20, "overspent", "daily_cap"]]);
    expect(["healthy", "fatigued", "overspent", "silent"].map((id) => [w.byId(id).state, w.transitions(id).length]))
      .toEqual([["live", 0], ["pausing", 1], ["pausing", 1], ["pausing", 1]]);
    // Fatigue rings no bell: the brief reports it.
    expect(w.bell.map((b) => b.category).sort()).toEqual(["ads_no_leads", "ads_overspend"]);
    // The monitor decides; the orchestrator's pausing step is the one that writes to Meta.
    expect(fake.requests.filter((q) => q.method === "POST")).toEqual([]);
    expectOrgScoped(w.rec, ORG);
  });
});
