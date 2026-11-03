import { describe, expect, it, vi } from "vitest";
import { SCHEDULERS } from "../../../schedulers.js";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { adsLeadsBackfillDedupKey, leadsBackfillEnqueue, leadsBackfillTick, startAdsLeadsBackfill, type BackfillEnqueue } from "./backfillTick.js";

vi.mock("../../../queue/dispatch.js", () => ({ dispatchJob: vi.fn(async () => ({ jobId: "job-1" })) }));

/** One keyed job per connected Meta connection, across carriers; the jobs ledger's dedup rule is the fake's. */
function ledger() {
  const active = new Set<string>();
  const calls: Array<{ org: string; conn: string }> = [];
  const enqueue: BackfillEnqueue = async (org, conn) => {
    calls.push({ org, conn });
    const key = adsLeadsBackfillDedupKey(conn);
    if (active.has(key)) return "conflict";
    active.add(key);
    return "queued";
  };
  return { enqueue, calls };
}
const admin = () => createSupabaseRecorder({
  tables: {
    ads_platform_connections: postgrestFixture([
      { id: "c1", org_id: "o1", provider: "meta", status: "connected" },
      { id: "c2", org_id: "o1", provider: "simulator", status: "connected" },
      { id: "c3", org_id: "o2", provider: "meta", status: "connected" },
      { id: "c4", org_id: "o2", provider: "meta", status: "disconnected" },
      { id: "c5", org_id: "o2", provider: "higgsfield", status: "connected" },
    ]),
  },
}).client as never;

describe("ads-leads-backfill — the hourly tick", () => {
  it("queues one job per connected Meta or simulator connection, each in its own slot, across carriers", async () => {
    const l = ledger();
    expect(await leadsBackfillTick(admin(), l.enqueue)).toEqual({ connections: 3, queued: 3, conflicts: 0 });
    expect(l.calls).toEqual([{ org: "o1", conn: "c1" }, { org: "o1", conn: "c2" }, { org: "o2", conn: "c3" }]);
  });
  it("a connection whose last backfill still runs is skipped this hour, not doubled", async () => {
    const l = ledger();
    await leadsBackfillTick(admin(), l.enqueue);
    expect(await leadsBackfillTick(admin(), l.enqueue)).toEqual({ connections: 3, queued: 0, conflicts: 3 });
  });
  it("the real enqueue keys each job by its connection, so a carrier's second connection does not wait behind its first", async () => {
    await leadsBackfillEnqueue({} as never, {} as never)("o1", "c2");
    expect(vi.mocked(dispatchJob)).toHaveBeenCalledWith({}, {}, "ads_leads_backfill", { orgId: "o1", payload: { connectionId: "c2" }, dedupKey: "ads_leads_backfill:c2" });
  });
  it("is registered once, in the general lane (workflow §1.2-7)", () => {
    expect(SCHEDULERS.filter((s) => s.name === "ads-leads-backfill").map((s) => s.lane)).toEqual(["general"]);
  });
  it("starts no timer unless ADS_ENABLED", () => {
    vi.useFakeTimers();
    const env = { ADS_ENABLED: false, SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" } as Parameters<typeof startAdsLeadsBackfill>[0];
    startAdsLeadsBackfill(env);
    expect(vi.getTimerCount()).toBe(0);
    startAdsLeadsBackfill({ ...env, ADS_ENABLED: true });
    expect(vi.getTimerCount()).toBe(2);
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
