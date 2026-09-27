import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { DESKTOP_QUERY, HANDOFF_POLL_MS, useHandoffPoll, useIsDesktop } from "./useDesktopHandoff";

/**
 * The desktop half of §6.6.6 (C3b2b2): "desktop" is a pointer media query, never the user agent, and
 * the poll asks only while it waits, only while the tab is visible, and moves on exactly once.
 */
describe("useIsDesktop", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the pointer, not the user agent — and follows it when it changes", () => {
    let listener: ((e: MediaQueryListEvent) => void) | null = null;
    const matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => (listener = fn),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    const scope = effectScope();
    const desktop = scope.run(() => useIsDesktop())!;
    expect(matchMedia).toHaveBeenCalledWith(DESKTOP_QUERY);
    expect(DESKTOP_QUERY).toBe("(hover: hover) and (pointer: fine)");
    expect(desktop.value).toBe(true);
    listener!({ matches: false } as MediaQueryListEvent);
    expect(desktop.value).toBe(false);
    scope.stop();
  });

  it("reads as a phone where there is no matchMedia, which offers the camera", () => {
    vi.stubGlobal("matchMedia", undefined);
    const scope = effectScope();
    expect(scope.run(() => useIsDesktop())!.value).toBe(false);
    scope.stop();
  });
});

describe("useHandoffPoll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  const run = (waiting: ReturnType<typeof ref<boolean>>, check: () => Promise<boolean>, arrived: () => void) => {
    const scope = effectScope();
    scope.run(() => useHandoffPoll(waiting as never, check, arrived));
    return scope;
  };

  it("asks every ten seconds while waiting, and moves on once when the photo arrives", async () => {
    const waiting = ref(true);
    let there = false;
    const check = vi.fn(async () => there);
    const arrived = vi.fn();
    const scope = run(waiting, check, arrived);

    // The literal, not the constant: ten seconds is the budget's number (six reads a minute against the
    // intake limiter's twenty), and a test that read the constant back would pass at any value.
    await vi.advanceTimersByTimeAsync(9_999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(arrived).not.toHaveBeenCalled();

    there = true;
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_MS);
    expect(arrived).toHaveBeenCalledTimes(1);
    // Stopped: nothing asks again, and nothing moves on twice.
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_MS * 3);
    expect(check).toHaveBeenCalledTimes(2);
    expect(arrived).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("asks nothing while not waiting, and stops the moment waiting ends", async () => {
    const waiting = ref(false);
    const check = vi.fn(async () => false);
    const scope = run(waiting, check, vi.fn());
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_MS * 2);
    expect(check).not.toHaveBeenCalled();

    waiting.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_MS);
    expect(check).toHaveBeenCalledTimes(1);
    waiting.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_MS * 2);
    expect(check).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("spends nothing while the tab is hidden, and catches up when it is shown", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const check = vi.fn(async () => true);
    const arrived = vi.fn();
    const scope = run(ref(true), check, arrived);
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_MS * 3);
    expect(check).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_MS);
    expect(arrived).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("keeps asking after a failed read", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
    const arrived = vi.fn();
    const scope = run(ref(true), check, arrived);
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_MS * 2);
    expect(arrived).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("stops when its screen goes away", async () => {
    const check = vi.fn(async () => false);
    const scope = run(ref(true), check, vi.fn());
    scope.stop();
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_MS * 2);
    expect(check).not.toHaveBeenCalled();
  });
});
