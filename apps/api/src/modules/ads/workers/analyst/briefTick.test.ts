import { describe, expect, it, vi } from "vitest";
import { SCHEDULERS } from "../../../../schedulers.js";
import { dispatchJob } from "../../../../queue/dispatch.js";
import { registerAllHandlers } from "../../../../queue/handlers/index.js";
import { getHandler } from "../../../../queue/registry.js";
import { adsDailyBriefDedupKey, briefDue, dailyBriefEnqueue, startAdsDailyBrief } from "./briefTick.js";

vi.mock("../../../../queue/dispatch.js", () => ({ dispatchJob: vi.fn(async () => ({ jobId: "job-1" })) }));

/** The tick's connection read is the leads backfill's (`metaConnectionsTick`, pinned in backfillTick.test.ts). */
describe("ads-daily-brief scheduler (F1b)", () => {
  it("keys the job by carrier, so a second connection's enqueue is the queue's 'already on it'", async () => {
    expect(await dailyBriefEnqueue({} as never, {} as never)("o1", "k2")).toBe("queued");
    expect(vi.mocked(dispatchJob)).toHaveBeenCalledWith({}, {}, "ads_daily_brief", { orgId: "o1", payload: {}, dedupKey: "ads_daily_brief:o1" });
    expect(adsDailyBriefDedupKey("o1")).toBe("ads_daily_brief:o1");
    vi.mocked(dispatchJob).mockResolvedValueOnce({ conflict: true } as never);
    expect(await dailyBriefEnqueue({} as never, {} as never)("o1", "k3")).toBe("conflict");
  });

  it("is due from 07:00 Central to midnight, never before", () => {
    expect(briefDue(new Date("2026-11-04T12:59:00Z"))).toBe(false); // 06:59 CST
    expect(briefDue(new Date("2026-11-04T13:00:00Z"))).toBe(true); // 07:00 CST
    expect(briefDue(new Date("2026-11-05T05:59:00Z"))).toBe(true); // 23:59 CST
    expect(briefDue(new Date("2026-11-05T06:00:00Z"))).toBe(false); // 00:00 CST
  });

  it("is registered once, in the general lane, with a handler", () => {
    registerAllHandlers();
    expect(SCHEDULERS.filter((s) => s.name === "ads-daily-brief").map((s) => s.lane)).toEqual(["general"]);
    expect(getHandler("ads_daily_brief")).toBeTypeOf("function");
  });

  it("starts no timer unless ADS_ENABLED", () => {
    vi.useFakeTimers();
    const env = { ADS_ENABLED: false, SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" } as Parameters<typeof startAdsDailyBrief>[0];
    startAdsDailyBrief(env);
    expect(vi.getTimerCount()).toBe(0);
    startAdsDailyBrief({ ...env, ADS_ENABLED: true });
    expect(vi.getTimerCount()).toBe(2);
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
