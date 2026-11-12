import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { emptyTally, longFrameSummary, longTasksObservable, tallyLongFrames, useLongFrames } from "./liveMapLongFrames";

/**
 * The long-frame counter behind the vector trial's basemap menu (HANDOFF-2026-11-10 §10.4 gap 2).
 *
 * What is worth pinning: that the figure belongs to ONE map (it restarts on a basemap change), that
 * the worst task is the maximum and not the last, that a browser without `longtask` is told so
 * rather than shown a zero, and that unmounting stops the observer and its timer — a leaked observer
 * keeps counting a map that is no longer on screen.
 */

/** A stand-in for the browser's observer: the test fires the entries. */
class FakePerformanceObserver {
  static supportedEntryTypes: readonly string[] = ["longtask"];
  static last: FakePerformanceObserver | null = null;
  readonly observed: unknown[] = [];
  disconnected = false;
  constructor(private readonly cb: (list: { getEntries: () => { duration: number }[] }) => void) {
    FakePerformanceObserver.last = this;
  }
  observe(options: unknown): void {
    this.observed.push(options);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  fire(durations: number[]): void {
    this.cb({ getEntries: () => durations.map((duration) => ({ duration })) });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakePerformanceObserver.last = null;
});

describe("tallyLongFrames", () => {
  it("counts every task, sums their time and keeps the worst, from an empty tally", () => {
    const t = tallyLongFrames(emptyTally(1000), [60, 120, 80]);
    expect(t).toEqual({ count: 3, totalMs: 260, worstMs: 120, sinceMs: 1000 });
  });

  it("keeps the earlier worst when later tasks are shorter, and does not mutate its input", () => {
    const first = tallyLongFrames(emptyTally(0), [300]);
    const second = tallyLongFrames(first, [60, 70]);
    expect(second.worstMs).toBe(300);
    expect(second.count).toBe(3);
    expect(first).toEqual({ count: 1, totalMs: 300, worstMs: 300, sinceMs: 0 });
  });

  it("is the same tally when nothing landed", () => {
    expect(tallyLongFrames(emptyTally(5), [])).toEqual(emptyTally(5));
  });
});

describe("longFrameSummary", () => {
  it("says zero and the elapsed seconds, with no worst figure, when nothing landed", () => {
    expect(longFrameSummary(emptyTally(10_000), 24_400)).toBe("Long frames: 0 in 14 s");
  });

  it("gives the count, the elapsed seconds and the worst task once something landed", () => {
    const t = tallyLongFrames(emptyTally(10_000), [60, 812.4]);
    expect(longFrameSummary(t, 40_000)).toBe("Long frames: 2 in 30 s, worst 812 ms");
  });

  it("never reports negative seconds when the clock is read before the tally's start", () => {
    expect(longFrameSummary(emptyTally(10_000), 9_000)).toBe("Long frames: 0 in 0 s");
  });
});

describe("longTasksObservable", () => {
  it("is true only when the browser lists longtask among its observable entry types", () => {
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    expect(longTasksObservable()).toBe(true);
    vi.stubGlobal("PerformanceObserver", class { static supportedEntryTypes = ["mark", "measure"]; });
    expect(longTasksObservable()).toBe(false);
    vi.stubGlobal("PerformanceObserver", undefined);
    expect(longTasksObservable()).toBe(false);
  });
});

describe("useLongFrames", () => {
  /** A host that owns the basemap ref and a hand-turned clock, so the test controls both. */
  function host(clock: () => number) {
    const basemap = ref("map");
    let api!: ReturnType<typeof useLongFrames>;
    const Host = defineComponent({
      setup() {
        api = useLongFrames(basemap, clock);
        return () => h("div");
      },
    });
    const wrapper = mount(Host);
    return { wrapper, basemap, api };
  }

  it("observes long tasks from mount and tallies what the browser reports", () => {
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    const { api } = host(() => 0);
    expect(api.available).toBe(true);
    expect(FakePerformanceObserver.last!.observed).toEqual([{ type: "longtask" }]);
    FakePerformanceObserver.last!.fire([55, 140]);
    expect(api.tally.value).toMatchObject({ count: 2, totalMs: 195, worstMs: 140 });
  });

  it("restarts the count, from the clock's current reading, when the basemap changes", async () => {
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    let t = 1000;
    const { api, basemap } = host(() => t);
    FakePerformanceObserver.last!.fire([90]);
    expect(api.tally.value.count).toBe(1);
    t = 6000;
    basemap.value = "vector";
    await nextTick();
    expect(api.tally.value).toEqual(emptyTally(6000));
    expect(api.now.value).toBe(6000);
  });

  it("moves the elapsed time once a second while mounted, so the line reads as a rate", () => {
    vi.useFakeTimers();
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    let t = 0;
    const { api } = host(() => t);
    t = 2500;
    vi.advanceTimersByTime(1000);
    expect(api.now.value).toBe(2500);
  });

  it("stops observing and ticking when unmounted", () => {
    vi.useFakeTimers();
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    let t = 0;
    const { api, wrapper } = host(() => t);
    const observer = FakePerformanceObserver.last!;
    wrapper.unmount();
    expect(observer.disconnected).toBe(true);
    t = 9000;
    vi.advanceTimersByTime(3000);
    expect(api.now.value).toBe(0);
  });

  it("reports itself unavailable, and never constructs an observer, where longtask is not observable", () => {
    const Bare = class {
      static supportedEntryTypes = ["mark"];
      constructor() {
        throw new Error("must not be constructed");
      }
    };
    vi.stubGlobal("PerformanceObserver", Bare);
    const { api } = host(() => 0);
    expect(api.available).toBe(false);
    expect(api.tally.value.count).toBe(0);
  });
});
