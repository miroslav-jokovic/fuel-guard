import { describe, it, expect } from "vitest";
import { hostname } from "node:os";
import {
  processHolderId,
  processHolderMeta,
  startLaneLease,
  type LeaseStore,
  type LeaseRead,
  type LeaseTimers,
} from "./schedulerLease.js";

/**
 * The lease protocol (D-RLY2) against a store that behaves like 0506's function and a clock the test
 * moves. What must hold: a lane's schedulers start once and only once a lease is held; a process that
 * loses the lease — taken, or unconfirmed past its deadline — says so; and two processes on one store
 * never both believe they hold the lane.
 */

/** 0506's semantics in memory: take when free or expired, renew when ours, else report the holder. */
function memoryStore(clock: { ms: number }) {
  let row: { holder: string; expiresMs: number } | null = null;
  const calls: string[] = [];
  let failing: string | null = null;
  let hang = false;
  const store: LeaseStore = {
    async acquire(_lane, holder, ttl): Promise<LeaseRead> {
      calls.push(`acquire:${holder}`);
      if (hang) return new Promise(() => {});
      if (failing) throw new Error(failing);
      if (!row || row.holder === holder || row.expiresMs <= clock.ms) row = { holder, expiresMs: clock.ms + ttl * 1000 };
      return { held: row.holder === holder, holder: row.holder, expiresAt: new Date(row.expiresMs).toISOString() };
    },
    async release(_lane, holder) {
      calls.push(`release:${holder}`);
      if (row?.holder === holder) row = { ...row, expiresMs: clock.ms };
    },
  };
  return {
    store,
    calls,
    fail: (m: string | null) => (failing = m),
    hang: (h: boolean) => (hang = h),
    holder: () => row?.holder ?? null,
  };
}

/** Timers the test drives: `advance(ms)` moves the clock and fires every interval that came due. */
function fakeTimers() {
  const clock = { ms: Date.parse("2026-10-20T12:00:00Z") };
  const intervals: { every: number; next: number; fn: () => void; live: boolean }[] = [];
  const timers: LeaseTimers = {
    now: () => clock.ms,
    every: (ms, fn) => {
      const t = { every: ms, next: clock.ms + ms, fn, live: true };
      intervals.push(t);
      return () => (t.live = false);
    },
  };
  const flush = () => new Promise((r) => setImmediate(r));
  const advance = async (ms: number) => {
    const end = clock.ms + ms;
    for (;;) {
      const due = intervals.filter((t) => t.live).sort((a, b) => a.next - b.next)[0];
      if (!due || due.next > end) break;
      clock.ms = due.next;
      due.next += due.every;
      due.fn();
      await flush();
    }
    clock.ms = end;
    await flush();
  };
  return { clock, timers, advance, flush };
}

function lease(name: string, t: ReturnType<typeof fakeTimers>, s: ReturnType<typeof memoryStore>) {
  const events: string[] = [];
  const l = startLaneLease({
    lane: "general",
    holder: name,
    store: s.store,
    timers: t.timers,
    log: () => {},
    onAcquired: () => events.push("started"),
    onLost: (reason) => events.push(`lost:${reason}`),
  });
  return { l, events };
}

describe("a scheduler lane's lease", () => {
  it("starts the lane's schedulers once, on the first held renewal, and keeps renewing without restarting them", async () => {
    const t = fakeTimers();
    const s = memoryStore(t.clock);
    const a = lease("A", t, s);
    await t.flush();
    expect(a.events).toEqual(["started"]);
    await t.advance(5 * 60_000);
    expect(a.events).toEqual(["started"]);
    expect(a.l.isHeld()).toBe(true);
    expect(s.calls.filter((c) => c === "acquire:A").length).toBeGreaterThan(10);
  });

  it("keeps a second process on standby while the first renews — the lane never runs twice", async () => {
    const t = fakeTimers();
    const s = memoryStore(t.clock);
    const a = lease("A", t, s);
    await t.flush();
    const b = lease("B", t, s);
    await t.advance(10 * 60_000);
    expect(a.events).toEqual(["started"]);
    expect(b.events).toEqual([]);
    expect(b.l.isHeld()).toBe(false);
  });

  it("hands the lane to the standby within one tick of a graceful release", async () => {
    const t = fakeTimers();
    const s = memoryStore(t.clock);
    const a = lease("A", t, s);
    await t.flush();
    const b = lease("B", t, s);
    await t.flush();
    await a.l.stop();
    expect(s.calls).toContain("release:A");
    await t.advance(15_000);
    expect(b.events).toEqual(["started"]);
    expect(s.holder()).toBe("B");
  });

  it("lets the standby take a crashed holder's lane once the lease expires, and not before", async () => {
    const t = fakeTimers();
    const s = memoryStore(t.clock);
    // A's process dies: from then on none of its calls arrive, and nothing is released.
    let aDead = false;
    const aStore: LeaseStore = {
      acquire: (...args) => (aDead ? new Promise(() => {}) : s.store.acquire(...args)),
      release: (...args) => s.store.release(...args),
    };
    startLaneLease({ lane: "general", holder: "A", store: aStore, timers: t.timers, log: () => {}, onAcquired: () => {}, onLost: () => {} });
    await t.flush();
    const b = lease("B", t, s);
    await t.flush();
    aDead = true;
    const crashedAt = t.clock.ms;
    await t.advance(59_000);
    expect(b.events).toEqual([]);
    await t.advance(16_000);
    expect(b.events).toEqual(["started"]);
    expect(t.clock.ms - crashedAt).toBeLessThanOrEqual(75_000);
  });

  it("stops trusting a lease it cannot confirm before the deadline — a hanging renewal cannot outlive it", async () => {
    const t = fakeTimers();
    const s = memoryStore(t.clock);
    const a = lease("A", t, s);
    await t.flush();
    s.hang(true);
    await t.advance(49_000);
    expect(a.events).toEqual(["started"]);
    await t.advance(2_000);
    expect(a.events).toEqual(["started", "lost:renewal not confirmed before the lease's deadline"]);
    expect(a.l.isHeld()).toBe(false);
  });

  it("rides out a failing renewal that recovers before the deadline", async () => {
    const t = fakeTimers();
    const s = memoryStore(t.clock);
    const a = lease("A", t, s);
    await t.flush();
    s.fail("fetch failed");
    await t.advance(30_000);
    s.fail(null);
    await t.advance(60_000);
    expect(a.events).toEqual(["started"]);
    expect(a.l.isHeld()).toBe(true);
  });

  it("gives the lane up when another process has taken it, and says so once", async () => {
    const t = fakeTimers();
    const s = memoryStore(t.clock);
    const a = lease("A", t, s);
    await t.flush();
    // A froze past its own deadline would exit; here the row is simply overwritten by B, as after a
    // take-over A never saw.
    s.store.acquire = async () => ({ held: false, holder: "B", expiresAt: null });
    await t.advance(15_000);
    await t.advance(60_000);
    expect(a.events).toEqual(["started", "lost:taken by B"]);
  });

  it("does not run the lane at all while the lease cannot be read — fail closed (missing function on staging)", async () => {
    const t = fakeTimers();
    const s = memoryStore(t.clock);
    s.fail("Could not find the function public.acquire_scheduler_lease");
    const a = lease("A", t, s);
    await t.advance(5 * 60_000);
    expect(a.events).toEqual([]);
    s.fail(null);
    await t.advance(15_000);
    expect(a.events).toEqual(["started"]);
  });

  it("releases on stop only what it holds", async () => {
    const t = fakeTimers();
    const s = memoryStore(t.clock);
    const a = lease("A", t, s);
    await t.flush();
    const b = lease("B", t, s);
    await t.flush();
    await b.l.stop();
    expect(s.calls).not.toContain("release:B");
    expect(s.holder()).toBe("A");
    expect(a.l.isHeld()).toBe(true);
  });
});

describe("processHolderMeta", () => {
  it("names an AWS container from the variables compose.yml sets, not as an anonymous local process", () => {
    const env = {
      SERVICE_NAME: "worker",
      DEPLOY_ENVIRONMENT: "production",
      DEPLOY_REGION: "us-west-2",
      GIT_COMMIT_SHA: "1533e3465aabd789cd144e933e41e5f3b2e2a4b1",
    };
    expect(processHolderMeta(env)).toEqual({
      service: "worker",
      environment: "production",
      deploymentId: null,
      replicaId: hostname(),
      region: "us-west-2",
      commit: "1533e3465aabd789cd144e933e41e5f3b2e2a4b1",
    });
    expect(processHolderId(env).startsWith(`worker:${hostname()}:`)).toBe(true);
  });

  it("still prefers Railway's own variables while Railway runs", () => {
    const env = { RAILWAY_SERVICE_NAME: "fleetguardapi", RAILWAY_REPLICA_ID: "r1", SERVICE_NAME: "api" };
    expect(processHolderMeta(env)).toMatchObject({ service: "fleetguardapi", replicaId: "r1" });
    expect(processHolderId(env).startsWith("fleetguardapi:r1:")).toBe(true);
  });

  it("leaves a local process unnamed rather than guessing", () => {
    expect(processHolderMeta({})).toMatchObject({ service: null, environment: null, replicaId: null, commit: null });
    expect(processHolderId({}).startsWith("local:")).toBe(true);
  });
});
