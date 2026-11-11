import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampaignState } from "@silvicom/shared";
import { loadEnv } from "../../../env.js";
import { campaign, createAdsWorld } from "../../../testing/adsWorld.js";
import { SCHEDULERS } from "../../../schedulers.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { adsStepDedupKey, adsStepEnqueue, orchestratorTick, startAdsOrchestrator, type Enqueue } from "./tick.js";

vi.mock("../../../queue/dispatch.js", () => ({ dispatchJob: vi.fn(async () => ({ jobId: "job-1" })) }));
import { adsWorkers, type CampaignWorkers } from "./workers.js";

const ALL: CampaignWorkers = { compose: async () => ({ ok: true }), createPaused: async () => ({ ok: true }), platform: async () => null, refresh: null };

/**
 * The jobs ledger's rule, as 0095 states it: with a dedup_key, ONE active job per key (a global
 * index); without one, one per (org, kind). The fake enforces exactly that, so a tick that forgot the
 * key would see its org's second campaign refused here as it would be in production.
 */
function ledger() {
  const active = new Set<string>();
  const calls: Array<{ orgId: string; campaignId: string; state: CampaignState; key: string }> = [];
  const enqueue: Enqueue = async (orgId, campaignId, state) => {
    const key = adsStepDedupKey(campaignId, state);
    calls.push({ orgId, campaignId, state, key });
    if (active.has(key)) return "conflict";
    active.add(key);
    return "queued";
  };
  return { enqueue, calls };
}

describe("orchestratorTick — it only enqueues, one keyed step per campaign with agent work", () => {
  it("two campaigns of one org each get their own slot, keyed by campaign and state", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "composing"), campaign("c2", "composing"), campaign("c3", "review")] });
    const l = ledger();
    expect(await orchestratorTick(w.admin, ALL, l.enqueue)).toEqual({ campaigns: 2, queued: 2, conflicts: 0 });
    expect(l.calls.map((c) => c.key)).toEqual(["ads_step:c1:composing", "ads_step:c2:composing"]);
    expect(w.rec.writes()).toEqual([]);
  });

  it("a second tick while the first step is in flight is the queue saying 'already on it'", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "composing")] });
    const l = ledger();
    await orchestratorTick(w.admin, ALL, l.enqueue);
    expect(await orchestratorTick(w.admin, ALL, l.enqueue)).toEqual({ campaigns: 1, queued: 0, conflicts: 1 });
  });

  it("with this build's workers (compose C5b2, the platform B3, the refresh Q-AD68), live, composing, launching and pausing are queued, switch or not", async () => {
    const live = [campaign("c1", "live"), campaign("c2", "composing"), campaign("c3", "launching"), campaign("c4", "pausing")];
    const quiet = ledger();
    const w1 = createAdsWorld({ campaigns: live });
    await orchestratorTick(w1.admin, adsWorkers({ admin: w1.admin, env: loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv), now: w1.now }), quiet.enqueue);
    // Since Q-AD68 a live campaign has agent work without the switch: its retired ads' replacements.
    expect(quiet.calls.map((c) => c.key).sort()).toEqual(["ads_step:c1:live", "ads_step:c2:composing", "ads_step:c3:launching", "ads_step:c4:pausing"]);
    const pressed = ledger();
    const w2 = createAdsWorld({ campaigns: live, kill: true });
    await orchestratorTick(w2.admin, adsWorkers({ admin: w2.admin, env: loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv), now: w2.now }), pressed.enqueue);
    expect(pressed.calls.map((c) => c.key).sort()).toEqual(["ads_step:c1:live", "ads_step:c2:composing", "ads_step:c3:launching", "ads_step:c4:pausing"]);
  });

  it("asks the database only for states the agent can act in, and nothing at all when there are none", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "archived")] });
    await orchestratorTick(w.admin, ALL, ledger().enqueue);
    const states = w.rec.forTable("ads_campaigns")[0]!.filters().find((f) => f.col === "state")!.val as string[];
    expect(states).not.toContain("archived");
    expect(states).not.toContain("review");
    const none = createAdsWorld({ campaigns: [] });
    await orchestratorTick(none.admin, { compose: null, createPaused: null, platform: null, refresh: null }, ledger().enqueue);
    expect(none.rec.forTable("ads_campaigns").length).toBeGreaterThan(0); // launching/live: the switch can always act
  });
});

describe("orchestratorTick — a live campaign is stepped for its refresh (Q-AD68)", () => {
  it("with a refresh worker every live campaign is queued each tick, the switch off; without one, live waits for the switch", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "live"), campaign("c2", "paused")] });
    const withRefresh = ledger();
    await orchestratorTick(w.admin, { ...ALL, refresh: async () => ({ ok: true }) }, withRefresh.enqueue);
    expect(withRefresh.calls.map((c) => c.key)).toEqual(["ads_step:c1:live"]);
    const without = ledger();
    await orchestratorTick(w.admin, ALL, without.enqueue);
    expect(without.calls).toEqual([]);
  });
});

describe("orchestratorTick — the brake and unreadable settings stop delivery, never the pause", () => {
  const live = () => [campaign("c1", "live"), campaign("c2", "composing"), campaign("c3", "launching"), campaign("c4", "pausing"), campaign("c5", "approved")];
  const withPlatform: CampaignWorkers = { ...ALL, platform: async () => null };

  it("under the brake every org is read as killed and only the pause path is queued; the settings are not even read", async () => {
    const w = createAdsWorld({ campaigns: live() });
    const l = ledger();
    await orchestratorTick(w.admin, withPlatform, l.enqueue, "ADS_ENABLED is off");
    expect(l.calls.map((c) => c.key).sort()).toEqual(["ads_step:c1:live", "ads_step:c3:launching", "ads_step:c4:pausing"]);
    expect(w.rec.forTable("ads_settings_versions")).toHaveLength(0);
  });

  it("an org whose settings row does not parse is read as killed, and the tick carries on", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "live")], settings: { not: "settings" } as never });
    const l = ledger();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await orchestratorTick(w.admin, withPlatform, l.enqueue)).toEqual({ campaigns: 1, queued: 1, conflicts: 0 });
    expect(l.calls.map((c) => c.key)).toEqual(["ads_step:c1:live"]);
    expect(quiet).toHaveBeenCalledWith(expect.stringMatching(/settings unreadable, treated as killed/));
    quiet.mockRestore();
  });
});

describe("adsStepEnqueue — what the queue is really handed", () => {
  it("an ads_step with the campaign and state in its payload, and dedup_key = campaign + state, never the (org, kind) slot", async () => {
    const env = { JOB_EXECUTION_MODE: "queue" } as Parameters<typeof adsStepEnqueue>[1];
    const enqueue = adsStepEnqueue(createAdsWorld({ campaigns: [] }).admin, env);
    expect(await enqueue("org-a", "c1", "composing")).toBe("queued");
    vi.mocked(dispatchJob).mockResolvedValueOnce({ conflict: true });
    expect(await enqueue("org-a", "c2", "live")).toBe("conflict");
    expect(vi.mocked(dispatchJob).mock.calls.map((c) => [c[2], c[3]])).toEqual([
      ["ads_step", { orgId: "org-a", payload: { campaignId: "c1", state: "composing" }, dedupKey: "ads_step:c1:composing" }],
      ["ads_step", { orgId: "org-a", payload: { campaignId: "c2", state: "live" }, dedupKey: "ads_step:c2:live" }],
    ]);
  });
});

describe("the ads-orchestrator scheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("is registered once, in the general lane (workflow §1.2-7)", () => {
    expect(SCHEDULERS.filter((s) => s.name === "ads-orchestrator").map((s) => s.lane)).toEqual(["general"]);
  });

  it("ticks with ADS_ENABLED off too, because the off flag is a brake, not the end of our pauses", () => {
    vi.useFakeTimers();
    const env = { ADS_ENABLED: false, SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" } as Parameters<typeof startAdsOrchestrator>[0];
    startAdsOrchestrator(env);
    expect(vi.getTimerCount()).toBe(2);
    vi.clearAllTimers();
    startAdsOrchestrator({ ...env, SUPABASE_SERVICE_ROLE_KEY: undefined } as unknown as typeof env);
    expect(vi.getTimerCount()).toBe(0);
  });
});
