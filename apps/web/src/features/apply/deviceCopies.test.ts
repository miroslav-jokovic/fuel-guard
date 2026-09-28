import { afterEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { effectScope } from "vue";
import { debouncedCopy, deleteCopy, putCopy, readCopy } from "./deviceCopies";

/**
 * The apply link's device store (AW10). Pinned here, beside the copies' own tests: C3d1a's one-day-old
 * database is deleted when this one first opens — a copy left in it would never be read or swept again,
 * and it holds a date of birth — and the two stores keep their copies apart.
 */

const openLegacy = () =>
  new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("silvicom-part-one", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("held", { keyPath: "key" });
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("held", "readwrite");
      tx.objectStore("held").put({ key: "k", answers: { date_of_birth: "1985-03-07" } });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
    req.onerror = () => reject(req.error);
  });

const row = (key: string) => ({ key, version: 1, expiresAt: "2099-01-01T00:00:00Z" });

describe("the device store", () => {
  it("deletes C3d1a's database, with the date of birth in it, the first time it opens", async () => {
    await openLegacy();
    expect((await indexedDB.databases()).map((d) => d.name)).toContain("silvicom-part-one");
    await readCopy("partOne", "k", () => true);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain("silvicom-part-one");
  });

  it("keeps Part 1's and Part 2's copies apart under the same key", async () => {
    await putCopy("partOne", { ...row("same"), which: "one" });
    await putCopy("partTwo", { ...row("same"), which: "two" });
    expect(await readCopy<ReturnType<typeof row> & { which: string }>("partOne", "same", () => true)).toMatchObject({ which: "one" });
    await deleteCopy("partOne", "same");
    expect(await readCopy("partOne", "same", () => true)).toBeNull();
    expect(await readCopy<ReturnType<typeof row> & { which: string }>("partTwo", "same", () => true)).toMatchObject({ which: "two" });
  });
});

/**
 * `debouncedCopy` (C3d3b1): the pause both copies of typed answers take, and the three ways it is cut short
 * — `now`, the phone put away, the page going — found necessary by the first browser test.
 */
describe("debouncedCopy", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  const make = () => {
    const write = vi.fn();
    const scope = effectScope();
    const copy = scope.run(() => debouncedCopy(write, 300))!;
    return { write, copy, stop: () => scope.stop() };
  };
  const hide = () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("writes once, after the pause since the last change", () => {
    vi.useFakeTimers();
    const { write, copy, stop } = make();
    copy.schedule();
    vi.advanceTimersByTime(200);
    copy.schedule();
    vi.advanceTimersByTime(200);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(write).toHaveBeenCalledTimes(1);
    stop();
  });

  it("writes at once on `now`, and the pending write it replaced does not follow", () => {
    vi.useFakeTimers();
    const { write, copy, stop } = make();
    copy.schedule();
    copy.now();
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(write).toHaveBeenCalledTimes(1);
    stop();
  });

  it("runs a pending write when the phone is put away or the page goes — and only a pending one", () => {
    vi.useFakeTimers();
    const { write, copy, stop } = make();
    hide();
    window.dispatchEvent(new Event("pagehide"));
    expect(write).not.toHaveBeenCalled();
    copy.schedule();
    hide();
    expect(write).toHaveBeenCalledTimes(1);
    copy.schedule();
    window.dispatchEvent(new Event("pagehide"));
    expect(write).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_000);
    expect(write).toHaveBeenCalledTimes(2);
    stop();
  });

  it("removes the very listeners it added when its scope ends — a remounted screen adds a fresh pair", () => {
    const added = [vi.spyOn(document, "addEventListener"), vi.spyOn(window, "addEventListener")];
    const removed = [vi.spyOn(document, "removeEventListener"), vi.spyOn(window, "removeEventListener")];
    const { stop } = make();
    const mine = (spy: (typeof added)[number]) =>
      spy.mock.calls.filter(([type]) => type === "visibilitychange" || type === "pagehide").map(([type, fn]) => [type, fn]);
    const listening = [...mine(added[0]!), ...mine(added[1]!)];
    expect(listening.map(([type]) => type).sort()).toEqual(["pagehide", "visibilitychange"]);
    stop();
    expect([...mine(removed[0]!), ...mine(removed[1]!)]).toEqual(expect.arrayContaining(listening));
    for (const spy of [...added, ...removed]) spy.mockRestore();
  });

  it("drops the pending write, and stops listening, when its scope ends", () => {
    vi.useFakeTimers();
    const { write, copy, stop } = make();
    copy.schedule();
    stop();
    vi.advanceTimersByTime(1_000);
    window.dispatchEvent(new Event("pagehide"));
    hide();
    expect(write).not.toHaveBeenCalled();
  });
});
