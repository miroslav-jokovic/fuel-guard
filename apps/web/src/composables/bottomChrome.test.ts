import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { bottomBaseHeight, bottomChromeHeight, useBottomChrome } from "./bottomChrome";

/**
 * Two layers along the bottom edge (DESIGN-SYSTEM-CONTRACT.md §9 rules 2 and 7): the shop's tab row on
 * the edge, a page's verbs standing on it. jsdom has no ResizeObserver and no layout, so both are
 * supplied: the observer reports at once, and each element says how tall it is.
 */
enableAutoUnmount(afterEach);
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    unobserve() {}
    disconnect() {}
  },
);

const bar = (height: number, base = false) =>
  defineComponent({
    setup() {
      const el = ref<HTMLElement | null>(null);
      useBottomChrome(el, { base });
      return () => h("div", { ref: (e) => { if (e) Object.defineProperty(e, "offsetHeight", { value: height }); el.value = e as HTMLElement; } });
    },
  });

describe("bottom chrome", () => {
  it("stacks a bar on the tab row: the bar stands at the row's height, and the total is both", async () => {
    mount(bar(57, true));
    mount(bar(72));
    await nextTick();
    expect(bottomBaseHeight.value).toBe(57);
    expect(bottomChromeHeight.value).toBe(57 + 72);
  });

  it("is a bar alone on the edge when no tab row is drawn, and nothing once both are gone", async () => {
    const walk = mount(bar(72));
    await nextTick();
    expect(bottomBaseHeight.value).toBe(0);
    expect(bottomChromeHeight.value).toBe(72);
    walk.unmount();
    expect(bottomChromeHeight.value).toBe(0);
  });
});
