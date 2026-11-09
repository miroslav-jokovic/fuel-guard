import { describe, expect, it, vi } from "vitest";
import { CAMPAIGN_STATES } from "@silvicom/shared";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { campaign, CONN, createAdsWorld, ORG, T0, type AdsWorld } from "../../../testing/adsWorld.js";
import { guardPlatform } from "../guard/guardedPlatform.js";
import type { PlatformOutcome } from "../platforms/adapter.js";
import { runCampaignStep } from "./runner.js";
import type { CampaignRow } from "./transitions.js";
import type { CampaignWorkers, WorkerResult } from "./workers.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const approval = (patch: Record<string, unknown> = {}) => ({
  id: "appr-1", org_id: ORG, campaign_id: "c1", kind: "launch", withdraws_id: null, approved_by: OWNER, approved_by_name: "Owner",
  daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, created_at: T0, ...patch,
});

/** Fakes for every worker, all present, so each test removes only what it is about. */
function fakes(w: AdsWorld, opts: { launch?: PlatformOutcome | Error; pause?: PlatformOutcome } = {}) {
  const launch = vi.fn(async () => {
    if (opts.launch instanceof Error) throw opts.launch;
    return opts.launch ?? { ok: true as const, platform_refs: { meta_campaign: "m-1" } };
  });
  const adapter = {
    safe: { readAccountHeadroomCents: vi.fn(async () => 300_000), readSpendCents: vi.fn(async () => 0), pause: vi.fn(async () => opts.pause ?? { ok: true as const }), pauseAd: vi.fn(async () => ({ ok: true as const })) },
    spend: { launch, raiseDailyBudget: vi.fn(), changeArea: vi.fn() },
  };
  const compose = vi.fn(async (_c: CampaignRow, _key: string): Promise<WorkerResult> => ({ ok: true }));
  const createPaused = vi.fn(async (): Promise<PlatformOutcome> => ({ ok: true, platform_refs: { meta_campaign: "m-1" } }));
  const workers: CampaignWorkers = {
    compose,
    createPaused,
    platform: vi.fn(async (_org: string, conn: string) => (conn === CONN ? guardPlatform(w.admin, w.now, "meta", adapter) : null)),
  };
  return { workers, compose, createPaused, launch, pause: adapter.safe.pause };
}

const step = (w: AdsWorld, workers: CampaignWorkers, id = "c1", expected?: Parameters<typeof runCampaignStep>[3]) =>
  runCampaignStep({ admin: w.admin, now: w.now, workers }, ORG, id, expected);

describe("runCampaignStep — the happy path, one step per job", () => {
  it("walks draft → composing → review, approved → creating → paused, launching → live, each with one transition row", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "draft")], approvals: [approval()] });
    const f = fakes(w);
    const seen: string[] = [];
    for (const _ of [1, 2]) seen.push(String((await step(w, f.workers)) && w.byId("c1").state));
    w.byId("c1").state = "approved"; // a person approved the creatives (E-phase door)
    for (const _ of [1, 2]) seen.push(String((await step(w, f.workers)) && w.byId("c1").state));
    w.byId("c1").state = "launching"; // an approver pressed Launch
    seen.push(String((await step(w, f.workers)) && w.byId("c1").state));
    expect(seen).toEqual(["composing", "review", "creating", "paused", "live"]);
    expect(w.byId("c1").platform_refs).toEqual({ meta_campaign: "m-1" });
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(w.transitions().every((a) => a.status === "succeeded")).toBe(true);
    expectOrgScoped(w.rec, ORG);
  });

  it("two campaigns in one org advance concurrently, neither waiting on the other", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "composing"), campaign("c2", "composing")] });
    const f = fakes(w);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inFlight = 0;
    let peak = 0;
    f.compose.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await gate; // both composes are in flight before either finishes
      inFlight -= 1;
      return { ok: true };
    });
    const both = Promise.all([step(w, f.workers, "c1"), step(w, f.workers, "c2")]);
    await vi.waitFor(() => expect(peak).toBe(2));
    release();
    await both;
    expect([w.byId("c1").state, w.byId("c2").state]).toEqual(["review", "review"]);
    expect(w.transitions("c1")).toHaveLength(1);
    expect(w.transitions("c2")).toHaveLength(1);
  });

  it("a job queued for a state the campaign has left does nothing", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "review")] });
    expect(await step(w, fakes(w).workers, "c1", "composing")).toEqual({ kind: "idle", state: "review", reason: "state_moved" });
    expect(w.actions).toEqual([]);
  });

  it("a worker not built yet leaves the campaign where it is, writing nothing", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "composing")] });
    expect(await step(w, { ...fakes(w).workers, compose: null })).toEqual({ kind: "idle", state: "composing", reason: "no_agent_work" });
    expect(w.actions).toEqual([]);
  });
});

describe("runCampaignStep — a compose still under way (C5b)", () => {
  it("a pending compose moves nothing and writes no row, and the next step with the same key finishes it", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "composing")] });
    const f = fakes(w);
    f.compose.mockResolvedValueOnce({ ok: false, pending: true, why: "render cr-1 still drawing" });
    expect(await step(w, f.workers)).toEqual({ kind: "idle", state: "composing", reason: "pending: render cr-1 still drawing" });
    expect(w.byId("c1").state).toBe("composing");
    expect(w.actions).toEqual([]);
    await step(w, f.workers);
    expect(w.byId("c1").state).toBe("review");
    expect(f.compose.mock.calls[0]![1]).toBe(f.compose.mock.calls[1]![1]);
  });
});

describe("runCampaignStep — a crashed step resumes once (at-least-once delivery, idempotent work)", () => {
  it("compose done, crash before the move: the retry hands the worker the SAME key and moves once", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "composing")] });
    const f = fakes(w);
    w.crashOnWrite("ads_campaigns");
    await expect(step(w, f.workers)).rejects.toThrow(/injected crash/);
    await step(w, f.workers);
    expect(w.byId("c1").state).toBe("review");
    expect(f.compose).toHaveBeenCalledTimes(2);
    expect(f.compose.mock.calls[0]![1]).toBe(f.compose.mock.calls[1]![1]);
    expect(w.transitions().map((a) => a.status)).toEqual(["succeeded"]);
  });

  it("launch sent, crash before the move: the retry reads the guard's row and never launches twice", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "launching")], approvals: [approval()] });
    const f = fakes(w);
    w.crashOnWrite("ads_campaigns");
    await expect(step(w, f.workers)).rejects.toThrow(/injected crash/);
    await step(w, f.workers);
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(w.byId("c1")).toMatchObject({ state: "live", platform_refs: { meta_campaign: "m-1" } });
    expect(w.actions.filter((a) => a.kind === "launch").map((a) => a.status)).toEqual(["succeeded"]);
  });

  it("a launch whose outcome is unknown (started, never completed) is paused, not marked stopped, and not re-sent", async () => {
    const w = createAdsWorld({
      campaigns: [campaign("c1", "launching")],
      approvals: [approval()],
      actions: [{ id: "act-0", org_id: ORG, campaign_id: "c1", kind: "launch", status: "started", approval_id: "appr-1", idempotency_key: "launch:appr-1", started_at: "2026-11-02T12:00:00.500Z" }],
    });
    const f = fakes(w);
    await step(w, f.workers);
    expect(f.launch).not.toHaveBeenCalled();
    expect(w.byId("c1").state).toBe("pausing");
    expect(w.transitions()[0]).toMatchObject({ cause: expect.stringMatching(/outcome unknown/) });
  });

  it("pause sent, crash before the move: the retry reads the pause row and moves once", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "pausing")] });
    const f = fakes(w);
    w.crashOnWrite("ads_campaigns");
    await expect(step(w, f.workers)).rejects.toThrow(/injected crash/);
    await step(w, f.workers);
    expect(f.pause).toHaveBeenCalledTimes(1);
    expect(w.byId("c1").state).toBe("paused");
  });
});

describe("runCampaignStep — the kill switch, in every state", () => {
  it("never launches; launching and live go to pausing; pausing pauses; every other state is unmoved by it", async () => {
    const after: Record<string, string> = {};
    for (const state of CAMPAIGN_STATES) {
      const w = createAdsWorld({ campaigns: [campaign("c1", state)], kill: true, approvals: [approval()] });
      const f = fakes(w);
      await step(w, f.workers);
      expect(f.launch, state).not.toHaveBeenCalled();
      after[state] = w.byId("c1").state;
      if (state === "launching" || state === "live") expect(w.transitions()[0]).toMatchObject({ request: expect.objectContaining({ event: "kill", to: "pausing" }), cause: "kill switch: owner pressed it" });
    }
    expect(after).toEqual({
      // composing and creating spend no ad money: the switch stops delivery, not the drafting.
      draft: "composing", composing: "review", review: "review", approved: "creating", creating: "paused",
      paused: "paused", launching: "pausing", live: "pausing", pausing: "paused", archived: "archived", failed: "failed",
    });
  });

  it("a live campaign is paused within two ticks of the switch, with no platform worker needed for the first", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "live")], kill: true });
    const f = fakes(w);
    await step(w, { ...f.workers, platform: null });
    expect(w.byId("c1").state).toBe("pausing");
    await step(w, f.workers);
    expect(w.byId("c1").state).toBe("paused");
    expect(w.actions.filter((a) => a.kind === "pause").map((a) => a.status)).toEqual(["succeeded"]);
  });
});

describe("runCampaignStep — the brake (ADS_ENABLED off) only pauses", () => {
  it("never launches, composes or creates; launching and live go to pausing with the brake as the cause; pausing pauses", async () => {
    const after: Record<string, string> = {};
    for (const state of CAMPAIGN_STATES) {
      const w = createAdsWorld({ campaigns: [campaign("c1", state)], approvals: [approval()] });
      const f = fakes(w);
      await runCampaignStep({ admin: w.admin, now: w.now, workers: f.workers, brake: "ADS_ENABLED is off" }, ORG, "c1");
      expect(f.launch, state).not.toHaveBeenCalled();
      expect(f.compose, state).not.toHaveBeenCalled();
      expect(f.createPaused, state).not.toHaveBeenCalled();
      after[state] = w.byId("c1").state;
      if (state === "launching" || state === "live") expect(w.transitions()[0]).toMatchObject({ cause: "kill switch: ADS_ENABLED is off" });
    }
    expect(after).toEqual({
      draft: "draft", composing: "composing", review: "review", approved: "approved", creating: "creating",
      paused: "paused", launching: "pausing", live: "pausing", pausing: "paused", archived: "archived", failed: "failed",
    });
  });

  it("settings that do not parse stop delivery instead of failing the step", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "live")], settings: { not: "settings" } as never });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await step(w, fakes(w).workers);
    quiet.mockRestore();
    expect(w.byId("c1").state).toBe("pausing");
    expect(w.transitions()[0]!.cause).toMatch(/^kill switch: settings unreadable/);
  });
});

describe("runCampaignStep — failure is a visible state", () => {
  it("a compose that fails, or throws, ends in failed with its reason in last_error", async () => {
    for (const fail of [async () => ({ ok: false as const, error: "renderer quota" }), async () => { throw new Error("renderer quota"); }]) {
      const w = createAdsWorld({ campaigns: [campaign("c1", "composing")] });
      const f = fakes(w);
      f.compose.mockImplementation(fail as never);
      await step(w, f.workers);
      expect(w.byId("c1")).toMatchObject({ state: "failed", last_error: "renderer quota" });
    }
  });

  it("a create that fails ends in failed", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "creating")] });
    const f = fakes(w);
    f.createPaused.mockResolvedValue({ ok: false, error_code: "meta_2703" });
    await step(w, f.workers);
    expect(w.byId("c1")).toMatchObject({ state: "failed", last_error: "meta_2703" });
  });

  it("a launch the guard refuses (no approval) goes back to paused with every refusal named, and nothing is sent", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "launching")], approvals: [] });
    const f = fakes(w);
    await step(w, f.workers);
    expect(f.launch).not.toHaveBeenCalled();
    expect(w.byId("c1")).toMatchObject({ state: "paused", last_error: "no_standing_approval" });
    expect(w.transitions()[0]!.cause).toMatch(/^refused: no_standing_approval/);
  });

  it("a launch the platform fails is paused and confirmed, never recorded as stopped on the 'failed' alone", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "launching")], approvals: [approval()] });
    const f = fakes(w, { launch: { ok: false, error_code: "rate_limited" } });
    await step(w, f.workers);
    expect(w.byId("c1")).toMatchObject({ state: "pausing", last_error: "rate_limited" });
    expect(w.transitions()[0]!.cause).toMatch(/^launch failed at the platform \(rate_limited\)/);
    await step(w, f.workers);
    expect(f.pause).toHaveBeenCalledTimes(1);
    expect(w.byId("c1").state).toBe("paused");
  });

  it("a launch that never reached the platform (no platform ids) goes back to paused with no pause sent", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "launching")], approvals: [approval()] });
    const f = fakes(w, { launch: { ok: false, error_code: "no_platform_ref" } });
    await step(w, f.workers);
    expect(f.pause).not.toHaveBeenCalled();
    expect(w.byId("c1")).toMatchObject({ state: "paused", last_error: "no_platform_ref" });
  });

  it("a pause that fails stays pausing under a new stamp, so the next tick asks again with a new key", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "pausing")] });
    const f = fakes(w, { pause: { ok: false, error_code: "rate_limited" } });
    await step(w, f.workers);
    expect(w.byId("c1")).toMatchObject({ state: "pausing", last_error: "rate_limited" });
    expect(w.byId("c1").state_changed_at).not.toBe(T0);
    f.pause.mockResolvedValue({ ok: true });
    await step(w, f.workers);
    expect(w.byId("c1").state).toBe("paused");
    const keys = w.actions.filter((a) => a.kind === "pause").map((a) => a.idempotency_key);
    expect(new Set(keys).size).toBe(2);
  });
});
