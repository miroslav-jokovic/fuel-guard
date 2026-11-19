import { describe, it, expect } from "vitest";
import { createRouter, createMemoryHistory, type RouteRecordRaw } from "vue-router";
import { adsRoutes } from "./routes/ads";

/**
 * Q-APX18 (a), 2026-11-18: the ads left `/recruitment/campaigns` and `/settings/recruiting/ads` for the Ads workspace,
 * and both old addresses redirect so a bookmark or a notification link still lands. The campaigns tab opens a campaign
 * from `?campaign=`, so the redirect has to carry the query — pushed through a real router over the real records
 * (components stubbed), because a vue-router redirect's query handling is exactly what a record-shape check misses
 * (memory "vue-router redirect keeps the query").
 */
const stub = { template: "<div />" };
const routes = adsRoutes.map((r) => ("component" in r ? { ...r, component: stub } : r)) as RouteRecordRaw[];

async function land(at: string) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(at);
  return router.currentRoute.value;
}

describe("the ads' old addresses", () => {
  it("the old campaigns address keeps the open campaign", async () => {
    const to = await land("/recruitment/campaigns?campaign=5b1e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b");
    expect([to.path, to.query]).toEqual(["/ads/campaigns", { campaign: "5b1e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b" }]);
  });

  it("Settings › Ads control lands on the workspace's Settings tab", async () => {
    const to = await land("/settings/recruiting/ads");
    expect([to.path, to.name]).toEqual(["/ads/settings", "ads-control-settings"]);
  });
});
