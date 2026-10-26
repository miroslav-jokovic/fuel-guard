import { describe, expect, it, vi } from "vitest";
import { createTtlCache, resetTtlCaches } from "./ttlCache.js";

/**
 * The request cache (Q-CHAT14). What it can get wrong: ask the database once per request anyway, keep
 * an answer past its life, keep a failure, let a burst ask once each, or store an answer that a
 * concurrent write has already made stale.
 */
describe("createTtlCache", () => {
  it("answers from the cache within its life and asks again after it", async () => {
    const c = createTtlCache<number>(1_000);
    const load = vi.fn(async () => 7);
    await c.get("k", load, 0);
    // `until` is stamped with the real clock when the load settles; ask relative to that.
    const t = Date.now();
    expect(await c.get("k", load, t + 500)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
    await c.get("k", load, t + 1_001);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one read among a burst of misses for the same key", async () => {
    const c = createTtlCache<string>(1_000);
    let release!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (release = r)));
    const burst = Array.from({ length: 300 }, () => c.get("org:messages", load));
    release("yes");
    expect(await Promise.all(burst)).toEqual(Array(300).fill("yes"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never keeps a failure: every waiter sees it, and the next ask reads again", async () => {
    const c = createTtlCache<number>(1_000);
    const load = vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce(3);
    await expect(Promise.all([c.get("k", load), c.get("k", load)])).rejects.toThrow("blip");
    expect(await c.get("k", load)).toBe(3);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("forgets the keys it is told to, and nothing else", async () => {
    const c = createTtlCache<number>(60_000);
    await c.get("a:1", async () => 1);
    await c.get("b:1", async () => 1);
    c.forget((k) => k.startsWith("a:"));
    const load = vi.fn(async () => 2);
    expect(await c.get("a:1", load)).toBe(2);
    expect(await c.get("b:1", load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not store an answer read before a write that forgot it", async () => {
    const c = createTtlCache<string>(60_000);
    let release!: (v: string) => void;
    const reading = c.get("k", () => new Promise<string>((r) => (release = r)));
    c.forget(() => true); // the write lands while the read is in flight
    release("before the write");
    expect(await reading).toBe("before the write");
    expect(await c.get("k", async () => "after the write")).toBe("after the write");
  });

  it("is emptied by resetTtlCaches", async () => {
    const c = createTtlCache<number>(60_000);
    await c.get("k", async () => 1);
    resetTtlCaches();
    expect(await c.get("k", async () => 2)).toBe(2);
  });
});
