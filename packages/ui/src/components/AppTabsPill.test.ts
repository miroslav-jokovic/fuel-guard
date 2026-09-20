import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mount } from "@vue/test-utils";
import AppTabs from "./AppTabs.vue";

/**
 * The tab strip's sliding pill (D-DT9, D-DT10, port plan T4).
 *
 * ⚠ **This file exists so that `AppTabs.test.ts` did not have to be opened.** That file is the
 * component's contract with a keyboard and a screen reader — the roving tabindex and the four arrow
 * keys that six hand-rolled copies got wrong — and the acceptance criterion for this change was
 * that it keeps passing UNTOUCHED. A visual upgrade that edits the accessibility suite to stay
 * green has quietly changed what the component promises; keeping the two files apart is what makes
 * "untouched" a thing anyone can check (`git diff` on that path is empty for this commit).
 *
 * ── WHY THESE TESTS ARE SHAPED LIKE THIS ───────────────────────────────────────────────────────
 * jsdom has no layout: every `offsetLeft` and `offsetWidth` is 0, so the pill measures nothing and
 * would sit at 0×0 forever. The stub below gives each tab a box — 100px wide, laid out end to end —
 * which is the smallest lie that lets the real measuring, spring and painting code run. What is
 * pinned is therefore the ARITHMETIC and the sequencing, not the pixels: that the pill lands on the
 * tab it was asked for, that it TRAVELS rather than teleporting, and that it continues from where
 * it is when the target changes mid-flight, which is the whole of D-DT10.
 */
const TABS = [
  { value: "drivers", label: "Drivers" },
  { value: "exports", label: "Exports" },
  { value: "audit", label: "Audit" },
];

/** 100px tabs at 0, 100, 200 — the index is readable straight off the offset. */
const WIDTH = 100;
const describeOffsets = () => {
  const index = (el: HTMLElement) => [...(el.parentElement?.querySelectorAll("button") ?? [])].indexOf(el as HTMLButtonElement);
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === "BUTTON" ? WIDTH : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === "BUTTON" ? Math.max(0, index(this)) * WIDTH : 0;
    },
  });
};

beforeAll(() => {
  describeOffsets();
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "offsetLeft");
});

const mountTabs = (modelValue = "drivers") =>
  mount(AppTabs, { props: { modelValue, tabs: TABS, label: "Qualification view" }, attachTo: document.body });

/** Advance the spring by wall-clock ms, one 16ms frame at a time, the way rAF would. */
const frames = async (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) {
    await vi.advanceTimersByTimeAsync(16);
  }
};

const pillOf = (wrapper: ReturnType<typeof mountTabs>) =>
  wrapper.get("span[aria-hidden='true']").element as HTMLElement;
const xOf = (el: HTMLElement) => Number(/translateX\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? NaN);

describe("AppTabs sliding pill", () => {
  it("places itself on the selected tab without animating in", async () => {
    const w = mountTabs("exports");
    await vi.advanceTimersByTimeAsync(0);
    const pill = pillOf(w);
    expect(xOf(pill)).toBe(WIDTH);
    expect(pill.style.width).toBe(`${WIDTH}px`);
    w.unmount();
  });

  /**
   * ⚠ The assertion that separates a spring from a jump. A teleport would already be at 200 on the
   * first frame after the click; a spring is somewhere strictly between the two tabs and still
   * moving. Both bounds matter — "not at the start" alone would pass for a jump.
   */
  it("travels rather than teleporting, then settles exactly on the tab", async () => {
    const w = mountTabs("drivers");
    await vi.advanceTimersByTimeAsync(0);
    await w.setProps({ modelValue: "audit" });
    await frames(100);

    const midFlight = xOf(pillOf(w));
    expect(midFlight).toBeGreaterThan(0);
    expect(midFlight).toBeLessThan(2 * WIDTH);

    await frames(600);
    expect(xOf(pillOf(w))).toBe(2 * WIDTH);
    w.unmount();
  });

  /**
   * ⚠ D-DT10, and the reason the spring reads its LIVE value every frame. Re-target mid-flight and
   * the pill must continue from where it is on screen — which means the frame after the second
   * click is still behind where the first flight had reached, not snapped back to the tab it left
   * or jumped forward to the one it is now heading for.
   */
  it("continues from where it is when the selection changes mid-flight", async () => {
    const w = mountTabs("drivers");
    await vi.advanceTimersByTimeAsync(0);
    await w.setProps({ modelValue: "audit" });
    await frames(100);
    const beforeRetarget = xOf(pillOf(w));

    await w.setProps({ modelValue: "exports" });
    await frames(16);
    const afterRetarget = xOf(pillOf(w));
    // Still carrying the velocity it had: it has not restarted at 0, nor jumped to 100.
    expect(afterRetarget).toBeGreaterThan(beforeRetarget - 1);
    expect(afterRetarget).not.toBe(WIDTH);

    await frames(800);
    expect(xOf(pillOf(w))).toBe(WIDTH);
    w.unmount();
  });

  /** Critically damped (D-DT9): no overshoot, ever — a tab click is a command, not a flick. */
  it("never overshoots the tab it is travelling to", async () => {
    const w = mountTabs("drivers");
    await vi.advanceTimersByTimeAsync(0);
    await w.setProps({ modelValue: "audit" });
    for (let i = 0; i < 60; i += 1) {
      await frames(16);
      expect(xOf(pillOf(w))).toBeLessThanOrEqual(2 * WIDTH);
    }
    w.unmount();
  });

  /** A rail has no pill at all — it marks its selection on the row (D-DT16). */
  it("draws no pill for a vertical rail", async () => {
    const w = mount(AppTabs, {
      props: { modelValue: "drivers", tabs: TABS, label: "Rail", orientation: "vertical" as const },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(w.find("span[aria-hidden='true']").exists()).toBe(false);
    w.unmount();
  });
});
