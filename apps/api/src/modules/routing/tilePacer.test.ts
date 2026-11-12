import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TilePacer, type TileTurn } from "./tilePacer.js";

/**
 * D-DR30: the pacer in front of HERE. Every property here is one the 2026-11-10 burst measurement
 * asked for: tiles over the rate wait instead of being refused, one caller cannot starve the rest,
 * and a tile the reader cancelled is never sent (so never billed).
 *
 * Fake timers drive both the bucket (it reads `Date.now`) and the queue (it uses `setTimeout`), so a
 * second of pacing is a second of fake time and the suite stays fast.
 */
const opts = { ratePerSecond: 10, burst: 3, maxWaitMs: 2_000, maxQueued: 5 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Ask for a turn and record when it was answered and how. */
function ask(p: TilePacer, key: string, log: string[], signal = new AbortController().signal): Promise<TileTurn> {
  return p.acquire(key, signal).then((turn) => {
    log.push(`${key}:${turn}@${Date.now()}`);
    return turn;
  });
}

describe("the HERE tile pacer", () => {
  it("sends a full burst at once, then holds the rest to the rate", async () => {
    const p = new TilePacer(opts);
    const log: string[] = [];
    const all = Array.from({ length: 5 }, () => ask(p, "ana", log));
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["ana:go@0", "ana:go@0", "ana:go@0"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(log.at(-1)).toBe("ana:go@100");
    await vi.advanceTimersByTimeAsync(100);
    expect(log.at(-1)).toBe("ana:go@200");
    await Promise.all(all);
    expect(p.drainCounts()).toMatchObject({ immediate: 3, queued: 2, maxWaitMs: 200, busy: 0, abandoned: 0 });
  });

  /**
   * ⚠⚠ THE FAIRNESS ASSERTION. Ana queues four tiles first, then Luis one. A FIFO would make Luis
   * wait behind all four of Ana's; round-robin gives him the very next token.
   */
  it("gives the next freed tile to a caller who has been waiting less, not to whoever queued most", async () => {
    const p = new TilePacer({ ...opts, burst: 1 });
    const log: string[] = [];
    void ask(p, "ana", log);
    for (let i = 0; i < 4; i++) void ask(p, "ana", log);
    void ask(p, "luis", log);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(log).toEqual(["ana:go@0", "ana:go@100", "luis:go@200"]);
  });

  /** A tile maplibre cancelled is dropped before HERE sees it, and leaves its token for the next one. */
  it("never sends a tile its reader cancelled while it waited, and does not spend a token on it", async () => {
    const p = new TilePacer({ ...opts, burst: 1 });
    const log: string[] = [];
    void ask(p, "ana", log);
    const cancel = new AbortController();
    void ask(p, "ana", log, cancel.signal);
    void ask(p, "luis", log);
    await vi.advanceTimersByTimeAsync(50);
    cancel.abort();
    await vi.advanceTimersByTimeAsync(50);
    expect(log).toEqual(["ana:go@0", "ana:gone@50", "luis:go@100"]);
    expect(p.drainCounts()).toMatchObject({ abandoned: 1, queued: 1 });
  });

  it("tells a caller to come back rather than holding a tile past the wait limit", async () => {
    const p = new TilePacer({ ratePerSecond: 0.1, burst: 1, maxWaitMs: 2_000, maxQueued: 5 });
    const log: string[] = [];
    void ask(p, "ana", log);
    void ask(p, "ana", log);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(log).toEqual(["ana:go@0", "ana:busy@2000"]);
    expect(p.drainCounts().busy).toBe(1);
  });

  it("refuses at once when the queue is full, so a flood cannot grow this process without bound", async () => {
    const p = new TilePacer({ ...opts, burst: 0, maxQueued: 2 });
    const log: string[] = [];
    void ask(p, "ana", log);
    void ask(p, "ana", log);
    await ask(p, "ana", log);
    expect(log).toEqual(["ana:busy@0"]);
  });

  it("refills while idle, but never past the burst", async () => {
    const p = new TilePacer(opts);
    const log: string[] = [];
    await Promise.all([ask(p, "a", log), ask(p, "a", log), ask(p, "a", log)]);
    await vi.advanceTimersByTimeAsync(10_000);
    log.length = 0;
    const next = Array.from({ length: 4 }, () => ask(p, "a", log));
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(next);
    expect(log).toHaveLength(4);
  });
});
