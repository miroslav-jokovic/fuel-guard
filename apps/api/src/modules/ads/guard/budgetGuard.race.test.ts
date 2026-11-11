import { describe, expect, it, vi } from "vitest";
import { campaign, createAdsWorld, ORG, T0 } from "../../../testing/adsWorld.js";
import { guardedSpend } from "./budgetGuard.js";

/**
 * §4R, the Budget guard's L2 row: "concurrent launches racing the cap" (step 8 — the readiness scorecard
 * showed it as the guard's one open L2 need). `budgetGuard.test.ts` reads a fixed world; this one runs two
 * launches at once over `adsWorld`, whose queries settle synchronously, so `Promise.all` interleaves the
 * two guards at their awaits exactly as two workers interleave at round trips.
 *
 * Why it holds without a lock: an approver's Launch moves the campaign into `launching` BEFORE its guard
 * runs, and the guard counts every campaign in launching / live / pausing in the forecast. So of two
 * launches racing, the later reader always sees the earlier one. The worst case is both refused — each
 * seeing the other — which spends nothing; never both sent past the cap.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const AGENT = { kind: "agent" as const, name: "Ads orchestrator" };
// Nov 2 in Chicago: 29 days left. $60/day forecasts $1,740 alone; two of them $3,480, over the $3,000 cap.
const DAILY = 6_000;
const LIFETIME = 60_000;

const approval = (id: string, campaignId: string) => ({
  id, org_id: ORG, campaign_id: campaignId, kind: "launch", withdraws_id: null, approved_by: OWNER, approved_by_name: "Owner",
  daily_budget_cents: DAILY, lifetime_cap_cents: LIFETIME, created_at: T0,
});

function race(states: { c1: "launching" | "paused"; c2: "launching" | "paused" }) {
  const w = createAdsWorld({
    campaigns: [
      campaign("c1", states.c1, { daily_budget_cents: DAILY, lifetime_cap_cents: LIFETIME }),
      campaign("c2", states.c2, { daily_budget_cents: DAILY, lifetime_cap_cents: LIFETIME }),
    ],
    approvals: [approval("appr-1", "c1"), approval("appr-2", "c2")],
  });
  const launch = vi.fn(async () => ({ ok: true as const }));
  const deps = {
    admin: w.admin, now: w.now,
    safe: { readAccountHeadroomCents: async () => 300_000, readSpendCents: async () => 0, pause: async () => ({ ok: true as const }), pauseAd: async () => ({ ok: true as const }), activateAd: async () => ({ ok: true as const }) },
    spend: { launch, raiseDailyBudget: vi.fn(), changeArea: vi.fn() },
  };
  const ask = (campaignId: string) => guardedSpend(deps, { orgId: ORG, campaignId, act: "launch", daily_cents: DAILY, lifetime_cents: LIFETIME, actor: AGENT });
  return { w, launch, ask };
}

describe("guardedSpend — two launches racing one monthly cap", () => {
  it("two campaigns launched at once, each fitting alone, never both reach the platform", async () => {
    const { launch, ask } = race({ c1: "launching", c2: "launching" });
    const outcomes = await Promise.all([ask("c1"), ask("c2")]);
    expect(launch.mock.calls.length).toBeLessThanOrEqual(1);
    expect(outcomes.filter((o) => o.kind === "succeeded").length).toBeLessThanOrEqual(1);
    for (const o of outcomes) if (o.kind === "refused") expect(o.refusals).toContain("monthly_cap_forecast");
  });

  it("each alone fits: the same launch with the other campaign paused is sent", async () => {
    const { launch, ask } = race({ c1: "launching", c2: "paused" });
    expect((await ask("c1")).kind).toBe("succeeded");
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("the second launch, asked after the first is sent, is refused by the first's daily budget", async () => {
    const { w, launch, ask } = race({ c1: "launching", c2: "paused" });
    expect((await ask("c1")).kind).toBe("succeeded");
    w.byId("c2").state = "launching"; // the approver presses Launch on the second
    const second = await ask("c2");
    expect(second).toMatchObject({ kind: "refused", refusals: expect.arrayContaining(["monthly_cap_forecast"]) });
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
