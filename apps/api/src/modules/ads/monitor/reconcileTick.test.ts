import { describe, expect, it, vi } from "vitest";
import { SCHEDULERS } from "../../../schedulers.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { adsReconcileDedupKey, reconcileEnqueue, startAdsReconcile } from "./reconcileTick.js";

vi.mock("../../../queue/dispatch.js", () => ({ dispatchJob: vi.fn(async () => ({ jobId: "job-1" })) }));

/** The tick's connection read is the leads backfill's (`metaConnectionsTick`, pinned in backfillTick.test.ts). */
describe("ads-reconcile scheduler (B5c)", () => {
  it("keys each job by its connection", async () => {
    expect(await reconcileEnqueue({} as never, {} as never)("o1", "c2")).toBe("queued");
    expect(vi.mocked(dispatchJob)).toHaveBeenCalledWith({}, {}, "ads_reconcile", { orgId: "o1", payload: { connectionId: "c2" }, dedupKey: "ads_reconcile:c2" });
    expect(adsReconcileDedupKey("c2")).toBe("ads_reconcile:c2");
  });

  it("is registered once, in the general lane, and ticks daily only when ADS_ENABLED", () => {
    expect(SCHEDULERS.filter((s) => s.name === "ads-reconcile").map((s) => s.lane)).toEqual(["general"]);
    vi.useFakeTimers();
    const env = { ADS_ENABLED: false, SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" } as Parameters<typeof startAdsReconcile>[0];
    startAdsReconcile(env);
    expect(vi.getTimerCount()).toBe(0);
    startAdsReconcile({ ...env, ADS_ENABLED: true });
    expect(vi.getTimerCount()).toBe(2);
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
