import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drainBudgetMs,
  drainJobs,
  isShuttingDown,
  resetShutdownStateForTests,
  trackJob,
} from "./shutdown.js";

/**
 * The shutdown pass (EFS audit 2026-09-30): every deploy used to kill the running job and leave its
 * slot held for the rest of a five-minute lease. These pin the three things that fixed it — new work
 * stops, running work gets the drain budget, and what is still running is handed back.
 */
afterEach(() => resetShutdownStateForTests());

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("drainBudgetMs", () => {
  it("is Railway's draining window less ten seconds for the hand-back", () => {
    expect(drainBudgetMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "45" })).toBe(35_000);
  });

  it("is zero when Railway gives no window — it would SIGKILL mid-wait anyway", () => {
    expect(drainBudgetMs({})).toBe(0);
    expect(drainBudgetMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "0" })).toBe(0);
    expect(drainBudgetMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "5" })).toBe(0);
    expect(drainBudgetMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "nonsense" })).toBe(0);
  });
});

describe("drainJobs", () => {
  it("a job that finishes inside the budget is waited for and never released", async () => {
    const job = deferred();
    const release = vi.fn(async () => undefined);
    const untrack = trackJob("j1", { kind: "efs_soap_posted", settled: job.promise, release });
    const draining = drainJobs(5_000);
    expect(isShuttingDown()).toBe(true);
    untrack();
    job.resolve();
    const out = await draining;
    expect(out).toEqual({ finished: ["efs_soap_posted j1"], released: [] });
    expect(release).not.toHaveBeenCalled();
  });

  it("a job still running at the deadline is released, so the next process can take its slot", async () => {
    vi.useFakeTimers();
    try {
      const release = vi.fn(async () => undefined);
      trackJob("j2", { kind: "efs_card_sync", settled: new Promise(() => undefined), release });
      const draining = drainJobs(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await draining).toEqual({ finished: [], released: ["efs_card_sync j2"] });
      expect(release).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("with no budget, everything running is released at once", async () => {
    const release = vi.fn(async () => undefined);
    trackJob("j3", { kind: "efs_soap_posted", settled: new Promise(() => undefined), release });
    expect((await drainJobs(0)).released).toEqual(["efs_soap_posted j3"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("one release that throws does not stop the others", async () => {
    const bad = vi.fn(async () => {
      throw new Error("db down");
    });
    const good = vi.fn(async () => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    trackJob("a", { kind: "k", settled: new Promise(() => undefined), release: bad });
    trackJob("b", { kind: "k", settled: new Promise(() => undefined), release: good });
    const out = await drainJobs(0);
    expect(out.released).toEqual(["k b"]);
    expect(good).toHaveBeenCalledOnce();
    errors.mockRestore();
  });
});
