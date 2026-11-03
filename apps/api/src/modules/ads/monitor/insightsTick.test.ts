import { describe, expect, it, vi } from "vitest";
import { SCHEDULERS } from "../../../schedulers.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { adsInsightsDedupKey, insightsEnqueue, startAdsInsights } from "./insightsTick.js";

vi.mock("../../../queue/dispatch.js", () => ({ dispatchJob: vi.fn(async () => ({ jobId: "job-1" })) }));

/** The tick's connection read is the leads backfill's (`metaConnectionsTick`, pinned in backfillTick.test.ts). */
describe("ads-insights scheduler (B5a)", () => {
  it("keys each job by its connection, so a carrier's second connection does not wait behind its first", async () => {
    expect(await insightsEnqueue({} as never, {} as never)("o1", "c2")).toBe("queued");
    expect(vi.mocked(dispatchJob)).toHaveBeenCalledWith({}, {}, "ads_insights", { orgId: "o1", payload: { connectionId: "c2" }, dedupKey: "ads_insights:c2" });
    expect(adsInsightsDedupKey("c2")).toBe("ads_insights:c2");
  });

  it("reads the queue's conflict as already running", async () => {
    vi.mocked(dispatchJob).mockResolvedValueOnce({ conflict: true } as never);
    expect(await insightsEnqueue({} as never, {} as never)("o1", "c2")).toBe("conflict");
  });

  it("is registered once, in the general lane (workflow §1.2-7)", () => {
    expect(SCHEDULERS.filter((s) => s.name === "ads-insights").map((s) => s.lane)).toEqual(["general"]);
  });

  it("starts no timer unless ADS_ENABLED", () => {
    vi.useFakeTimers();
    const env = { ADS_ENABLED: false, SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" } as Parameters<typeof startAdsInsights>[0];
    startAdsInsights(env);
    expect(vi.getTimerCount()).toBe(0);
    startAdsInsights({ ...env, ADS_ENABLED: true });
    expect(vi.getTimerCount()).toBe(2);
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
