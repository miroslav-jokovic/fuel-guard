import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_CAMPAIGN_WORKERS, type AdsReadinessLevel } from "@silvicom/shared";
import { ORG, campaign, createAdsWorld } from "../../../testing/adsWorld.js";
import { testEnv } from "../../../testing/testEnv.js";
import { launchCampaign } from "./campaignDoors.js";
import { CAMPAIGN_CREATIVE_KIND, launchCertification, plannedKind, type LaunchReadiness } from "./launchCertification.js";

/**
 * A campaign that carries a plan used the Strategist, so its launch waits on that worker too (V2c, Q-APX6);
 * a campaign that was never planned is not held back by an agent it never used.
 */
const STILL = ADS_CAMPAIGN_WORKERS[`meta:${CAMPAIGN_CREATIVE_KIND}`]!;
const PLANNED = ADS_CAMPAIGN_WORKERS[`meta:${plannedKind(CAMPAIGN_CREATIVE_KIND)}`]!;
const keyOf = (u: { worker: string; platform: string | null }) => (u.platform ? `${u.worker}|${u.platform}` : u.worker);
/** Every worker at L4 except the Strategist, which is at `strategist`. */
const readiness = (strategist: AdsReadinessLevel): LaunchReadiness => ({
  workers: ADS_CAMPAIGN_WORKERS,
  levels: { ...Object.fromEntries(STILL.map((u) => [keyOf(u), "L4" as AdsReadinessLevel])), Strategist: strategist },
});

describe("the launch gate's table", () => {
  it("a planned campaign uses every worker an unplanned one does, and the Strategist, and nothing else", () => {
    expect(PLANNED).toEqual([...STILL, { worker: "Strategist", platform: null }]);
    expect(STILL.some((u) => u.worker === "Strategist")).toBe(false);
  });
});

describe("launchCertification — the Strategist is needed only by a campaign that was planned", () => {
  it("planned, with the Strategist below L4: refused, naming it alone", () => {
    const cert = launchCertification({ provider: "meta", planned: true }, readiness("L2"));
    expect(cert).toMatchObject({ ok: false, refusal: "not_certified", missing: [{ worker: "Strategist", level: "L2", needs: "L4" }] });
  });

  it("never planned, with the Strategist below L4: not held back", () => {
    expect(launchCertification({ provider: "meta", planned: false }, readiness("L2"))).toEqual({ ok: true, exempt: null });
    expect(launchCertification({ provider: "meta" }, readiness("L2"))).toEqual({ ok: true, exempt: null });
  });

  it("planned, with the Strategist at L4: passes", () => {
    expect(launchCertification({ provider: "meta", planned: true }, readiness("L4"))).toEqual({ ok: true, exempt: null });
  });
});

describe("launchCampaign — the door reads whether the campaign carries a plan", () => {
  // The certification rule is production's; a non-production host asks D-AD8's sandbox rule first (launchGate.test.ts).
  beforeEach(() => vi.stubEnv("DEPLOY_ENVIRONMENT", "production"));
  afterEach(() => vi.unstubAllEnvs());
  const C = "70000000-0000-4000-8000-000000000001";
  const approvals = [{ id: "ap-1", org_id: ORG, campaign_id: C, kind: "launch", withdraws_id: null, approved_by: "u-admin", approved_by_name: "Owner", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, created_at: "2026-11-02T11:00:00Z" }];
  const launch = (planId: string | null) => {
    const w = createAdsWorld({ campaigns: [campaign(C, "paused", { plan_id: planId })], approvals });
    return launchCampaign(w.admin, ORG, { id: "u-admin", name: "Owner" }, C, { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }, new Date("2026-11-15T19:00:00Z"), readiness("L2"), { env: testEnv() });
  };

  it("a campaign with a plan on it is refused for the Strategist; the same campaign without one is not refused for it", async () => {
    const planned = await launch("71000000-0000-4000-8000-000000000001");
    expect(planned).toMatchObject({ kind: "launch_refused", refusal: "not_certified", missing: [{ worker: "Strategist" }] });
    const unplanned = await launch(null);
    expect(unplanned.kind === "launch_refused" && unplanned.refusal === "not_certified").toBe(false);
  });
});
