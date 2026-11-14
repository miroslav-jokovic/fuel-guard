import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { PULL_THRESHOLD_PX, mayStartPull, usePullToRefresh } from "@/lib/pullToRefresh";

/**
 * Pull down to refresh in the installed app (CHAT-WEB-PUSH-PLAN D-WP17): where a pull may start, that only a
 * long enough pull reloads, and that a browser tab — which has its own — gets no listener at all.
 */
let standalone = true;
let touchPoints = 5;
beforeEach(() => {
  standalone = true;
  touchPoints = 5;
  vi.stubGlobal("navigator", { userAgent: "iPhone", get maxTouchPoints() { return touchPoints; }, get standalone() { return standalone; } });
  window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
  document.body.innerHTML = "";
});
afterEach(() => vi.unstubAllGlobals());

function el(html: string): Element {
  document.body.innerHTML = html;
  return document.querySelector("#t")!;
}

describe("where a pull may start", () => {
  it("on ordinary page content, at the top, with one finger", () => {
    expect(mayStartPull(el("<main><p id=t>Drivers</p></main>"), 0, 1)).toBe(true);
  });
  it("not once the page is scrolled, and not with two fingers", () => {
    const t = el("<main><p id=t>Drivers</p></main>");
    expect(mayStartPull(t, 12, 1)).toBe(false);
    expect(mayStartPull(t, 0, 2)).toBe(false);
  });
  it("not inside a dialog or drawer, a field, a map, a canvas, or anything that opts out", () => {
    for (const html of [
      "<div role=dialog><p id=t>Add driver</p></div>",
      "<div aria-modal=true><p id=t>x</p></div>",
      "<input id=t>",
      "<textarea id=t></textarea>",
      "<div class=maplibregl-map><div id=t></div></div>",
      "<canvas id=t></canvas>",
      "<div data-no-pull-refresh><p id=t>x</p></div>",
    ]) expect(mayStartPull(el(html), 0, 1), html).toBe(false);
  });
  it("not inside an element that scrolls by itself", () => {
    const t = el("<div id=s style='overflow-y:auto'><p id=t>line</p></div>");
    const s = document.querySelector("#s")!;
    Object.defineProperty(s, "scrollHeight", { value: 900 });
    Object.defineProperty(s, "clientHeight", { value: 300 });
    expect(mayStartPull(t, 0, 1)).toBe(false);
  });
});

function touch(type: string, y: number, target: Element = document.body, fingers = 1) {
  const e = new Event(type, { bubbles: true }) as Event & { touches: Array<{ clientY: number }> };
  e.touches = Array.from({ length: type === "touchend" ? 0 : fingers }, () => ({ clientY: y }));
  target.dispatchEvent(e);
}

function harness() {
  const reload = vi.fn();
  let api!: ReturnType<typeof usePullToRefresh>;
  const w = mount(defineComponent({ setup() { api = usePullToRefresh(reload); return () => h("div"); } }), { attachTo: document.body });
  const page = document.createElement("p");
  document.body.appendChild(page);
  return { reload, api, w, page };
}

describe("the gesture", () => {
  it("reloads when let go past the threshold, and takes the browser's own gesture over", async () => {
    const { reload, api, page } = harness();
    expect(document.documentElement.style.overscrollBehaviorY).toBe("contain");
    touch("touchstart", 10, page);
    touch("touchmove", 10 + PULL_THRESHOLD_PX * 2 + 2, page); // half of the finger's travel reaches the indicator
    await nextTick();
    expect(api.distance.value).toBeGreaterThanOrEqual(PULL_THRESHOLD_PX);
    touch("touchend", 0, page);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(api.refreshing.value).toBe(true);
  });

  it("a short pull, or one the page scrolled under, refreshes nothing", () => {
    const { reload, api, page } = harness();
    touch("touchstart", 10, page);
    touch("touchmove", 60, page);
    touch("touchend", 0, page);
    expect(api.distance.value).toBe(0);
    touch("touchstart", 10, page);
    touch("touchmove", 400, page);
    (window as { scrollY: number }).scrollY = 30;
    touch("touchmove", 420, page);
    touch("touchend", 0, page);
    expect(reload).not.toHaveBeenCalled();
  });

  it("a pull that begins in a drawer never reloads", () => {
    const { reload } = harness();
    const drawer = el("<div role=dialog><p id=t>half a form</p></div>");
    touch("touchstart", 10, drawer);
    touch("touchmove", 500, drawer);
    touch("touchend", 0, drawer);
    expect(reload).not.toHaveBeenCalled();
  });

  it("listens to nothing in a browser tab, which has its own, and on a screen without touch", () => {
    for (const set of [() => { standalone = false; }, () => { touchPoints = 0; }]) {
      standalone = true; touchPoints = 5; set();
      document.documentElement.style.overscrollBehaviorY = "";
      const { reload, w, page } = harness();
      expect(document.documentElement.style.overscrollBehaviorY).toBe("");
      touch("touchstart", 10, page);
      touch("touchmove", 500, page);
      touch("touchend", 0, page);
      expect(reload).not.toHaveBeenCalled();
      w.unmount();
    }
  });
});
