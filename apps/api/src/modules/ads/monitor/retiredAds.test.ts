import { describe, expect, it } from "vitest";
import { createAdsWorld, CONN, ORG } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { retiredAdIds } from "./retiredAds.js";

/**
 * Which ads a launch must leave off (CQ9b, the 2026-11-11 relaunch finding): read per AD from the `retire_ad`
 * ledger. A confirmed or crashed-mid-way retire counts; a refused one does not; another campaign's, another org's
 * and another kind's rows never do.
 */
const row = (id: string, patch: Record<string, unknown>) => ({
  id, org_id: ORG, campaign_id: "c1", connection_id: CONN, kind: "retire_ad", status: "succeeded", actor_kind: "agent", actor_name: "monitor", ...patch,
});

describe("retiredAdIds — the launch's list of ads to leave off", () => {
  it("counts succeeded and started retire_ad rows, once each; never a failed one, another campaign's, another org's or another kind", async () => {
    const w = createAdsWorld({
      campaigns: [],
      actions: [
        row("a1", { request: { ad: "901" } }),
        row("a2", { status: "started", request: { ad: "902" } }),
        row("a3", { status: "failed", request: { ad: "903" } }),
        row("a4", { campaign_id: "c2", request: { ad: "904" } }),
        row("a5", { org_id: "00000000-0000-4000-8000-0000000000ff", request: { ad: "905" } }),
        row("a6", { kind: "pause", request: { ad: "906" } }),
        row("a7", { request: { ad: "901" } }),
        row("a8", { request: {} }),
      ],
    });
    expect((await retiredAdIds(w.admin, ORG, "c1")).sort()).toEqual(["901", "902"]);
    expectOrgScoped(w.rec, ORG);
  });

  it("a campaign with no retired ad answers an empty list, so its launch turns on every ad as before", async () => {
    expect(await retiredAdIds(createAdsWorld({ campaigns: [] }).admin, ORG, "c1")).toEqual([]);
  });
});
