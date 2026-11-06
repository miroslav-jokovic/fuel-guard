import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_USER, campaign, CONN, createAdsWorld, ORG, type AdsWorld } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { backfillConnectionLeads } from "../leads/backfill.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, SIMULATOR_PAGE_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { pullConnectionInsights } from "./insightsPull.js";
import { reconcileConnection } from "./reconcile.js";

/**
 * ADS-RUNBOOK Gap 4 (monitor-alerts, 2026-11-06): a dead token rings the bell from the hourly jobs that meet it,
 * not only from a pause or a create. Each road runs for real over the simulator with the owner's access revoked
 * in Business Settings (`FakeMeta.revokeToken`: every call 190/463, the Page token too). The bell is the world's
 * `emit_notification` with its dedupe, so "once per connection per outage day" is the database's answer here as
 * it is in production, and the alert is the one the pause and create paths already send (`connectionAlerts.ts`).
 */

const connection = { id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, page_token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" };

let fake: FakeMeta;
let w: AdsWorld;
beforeEach(async () => {
  resetGraphThrottles();
  fake = await simulatorFakeForTests();
  // A real form on the simulator's Page, so a working token reads it (an unknown form is refused as a bad token).
  const form = (fake.forms.create(SIMULATOR_PAGE_ID, {
    name: "S360|SIM|form|EN", locale: "EN_US", questions: JSON.stringify([{ type: "FULL_NAME", key: "full_name" }]),
    privacy_policy: JSON.stringify({ url: "https://silvicom.test/privacy" }),
  }).body as { id: string }).id;
  const refs = { meta_campaign_id: "600", meta_adset_id: "601", meta_form_ids: { en: form } };
  w = createAdsWorld({ campaigns: [campaign("c1", "live", { platform_refs: refs, brief_source: "recruiting_opening", brief_ref: "op-1@v1" })], connections: [connection] });
});
afterEach(async () => stopSimulatorForTests());

const deps = () => ({ admin: w.admin, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: w.now });
const sink = { store: async () => { throw new Error("no lead should reach the sink"); } } as never;
const ROADS: Array<[string, () => Promise<{ failures: Array<{ reason: string }> }>]> = [
  ["the hourly insights pull", () => pullConnectionInsights(deps(), ORG, CONN)],
  ["the leads backfill", () => backfillConnectionLeads({ ...deps(), sink }, ORG, CONN)],
  ["reconcile", () => reconcileConnection(deps(), ORG, CONN)],
];
const tokenBells = () => w.bell.filter((b) => b.category === "ads_token_expiring");

describe("a dead token rings the bell from the hourly jobs (ADS-RUNBOOK Gap 4)", () => {
  it.each(ROADS)("%s: one critical bell to the admins, the connection marked failing, and the run still fails", async (_name, run) => {
    fake.revokeToken();
    const out = await run();
    expect(out.failures.map((f) => f.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/token_invalid$/)]));
    expect(tokenBells()).toEqual([{ user: ADMIN_USER, category: "ads_token_expiring", title: "An ad account connection stopped working", severity: "critical", dedupe: `ads_token_expiring:${CONN}:2026-11-02` }]);
    expect(w.connections[0]).toMatchObject({ status: "failing" });
    expectOrgScoped(w.rec, ORG, { exempt: ["memberships"] });
  });

  it.each(ROADS)("%s: a second run in the same outage rings nothing new, and still fails", async (_name, run) => {
    fake.revokeToken();
    await run();
    const again = await run();
    expect(again.failures.length).toBeGreaterThan(0);
    expect(tokenBells()).toHaveLength(1);
  });

  it("the three roads in one outage are one bell between them: the alert is shared, not one per job", async () => {
    fake.revokeToken();
    for (const [, run] of ROADS) await run();
    expect(tokenBells()).toHaveLength(1);
  });

  it("reconcile rings on its own reads too, not only through the pull inside it", async () => {
    // The pull reads `600/insights`; only reconcile's read of the campaign object is `600` itself.
    fake.inject("GET", /^600$/, { kind: "token_expired" });
    const out = await reconcileConnection(deps(), ORG, CONN);
    // The pull met no refused token (this fixture holds no campaign 600 at Meta, so it fails `meta_100`, not 190).
    expect(out.insights?.failures.map((f) => f.reason).some((r) => r.endsWith("token_invalid"))).toBe(false);
    expect(out.failures).toEqual(expect.arrayContaining([{ campaign_id: "c1", reason: "graph:token_invalid" }]));
    expect(tokenBells()).toHaveLength(1);
  });

  it.each(ROADS)("%s: a working token rings nothing", async (_name, run) => {
    await run();
    expect(tokenBells()).toEqual([]);
    expect(w.connections[0]).toMatchObject({ status: "connected" });
  });
});
