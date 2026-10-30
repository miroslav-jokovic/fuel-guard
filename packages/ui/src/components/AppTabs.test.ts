import { describe, it, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import AppTabs from "./AppTabs.vue";

/**
 * `AppTabs` (UI plan U4, D-UI4).
 *
 * ⚠ What is pinned here is the KEYBOARD, because that is the entire reason this component exists.
 * Six pages hand-rolled `role="tablist"` and not one of them handled a key or managed a tabindex —
 * the markup promised a screen reader and a keyboard user a widget they could not drive. The class
 * list was never the problem; six copies of a broken interaction contract was.
 */
const TABS = [
  { value: "drivers", label: "Drivers" },
  { value: "exports", label: "Exports" },
  { value: "audit", label: "Audit" },
];

const mountTabs = (modelValue = "drivers", props: Record<string, unknown> = {}) =>
  mount(AppTabs, { props: { modelValue, tabs: TABS, label: "Qualification view", ...props }, attachTo: document.body });

describe("AppTabs keyboard contract", () => {
  /** WAI-ARIA's tabs pattern: exactly ONE tab in the page's tab order, the selected one. */
  it("keeps a roving tabindex — one tab reachable by Tab, not three", () => {
    const w = mountTabs("exports");
    expect(w.findAll("button").map((b) => b.attributes("tabindex"))).toEqual(["-1", "0", "-1"]);
  });

  it("moves selection with Left and Right", async () => {
    const w = mountTabs("drivers");
    await w.get('[role="tablist"]').trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["exports"]);

    const back = mountTabs("exports");
    await back.get('[role="tablist"]').trigger("keydown", { key: "ArrowLeft" });
    expect(back.emitted("update:modelValue")?.at(-1)).toEqual(["drivers"]);
  });

  it("wraps at both ends rather than dead-ending", async () => {
    const last = mountTabs("audit");
    await last.get('[role="tablist"]').trigger("keydown", { key: "ArrowRight" });
    expect(last.emitted("update:modelValue")?.at(-1)).toEqual(["drivers"]);

    const first = mountTabs("drivers");
    await first.get('[role="tablist"]').trigger("keydown", { key: "ArrowLeft" });
    expect(first.emitted("update:modelValue")?.at(-1)).toEqual(["audit"]);
  });

  it("jumps to the ends with Home and End", async () => {
    const w = mountTabs("exports");
    await w.get('[role="tablist"]').trigger("keydown", { key: "Home" });
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["drivers"]);
    await w.get('[role="tablist"]').trigger("keydown", { key: "End" });
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["audit"]);
  });

  /** ⚠ Swallowing every key would trap Tab inside the widget — the opposite of the fix. */
  it("leaves keys it does not handle alone", async () => {
    const w = mountTabs("drivers");
    await w.get('[role="tablist"]').trigger("keydown", { key: "Tab" });
    await w.get('[role="tablist"]').trigger("keydown", { key: "a" });
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("moves focus with the selection, so the next arrow continues from where the user is", async () => {
    const w = mountTabs("drivers");
    await w.get('[role="tablist"]').trigger("keydown", { key: "ArrowRight" });
    expect(document.activeElement).toBe(w.findAll("button")[1]!.element);
  });
});

describe("AppTabs markup contract", () => {
  it("announces itself with the name it was given", () => {
    expect(mountTabs().get('[role="tablist"]').attributes("aria-label")).toBe("Qualification view");
  });

  it("marks exactly one tab selected", () => {
    const w = mountTabs("exports");
    expect(w.findAll("button").map((b) => b.attributes("aria-selected"))).toEqual(["false", "true", "false"]);
  });

  /** ⚠ A dangling aria-controls is worse than none, so ids appear only when a prefix is given. */
  it("wires aria-controls only when the page has panels to point at", () => {
    expect(mountTabs("drivers").get('[role="tab"]').attributes("aria-controls")).toBeUndefined();

    const withPanels = mountTabs("drivers", { idPrefix: "qualification" });
    const first = withPanels.get('[role="tab"]');
    expect(first.attributes("id")).toBe("qualification-tab-drivers");
    expect(first.attributes("aria-controls")).toBe("qualification-panel-drivers");
  });

  it("renders a badge only when one is given", () => {
    const w = mount(AppTabs, {
      props: {
        modelValue: "open",
        tabs: [{ value: "open", label: "Open", badge: 12 }, { value: "done", label: "Done" }],
        label: "Load queue",
      },
    });
    expect(w.findAll("button")[0]!.text()).toContain("12");
    expect(w.findAll("button")[1]!.text()).toBe("Done");
  });

  it("selects on click", async () => {
    const w = mountTabs("drivers");
    await w.findAll("button")[2]!.trigger("click");
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["audit"]);
  });

  /**
   * ── THE WELL IS AS WIDE AS ITS TABS (D-DT20) ──────────────────────────────────────────────────
   * It was a block `flex`, so on any page that gave it room the well ran the full width — on the
   * Dashboard, a 1104px pale band with two tabs at the left end of it, drawn across the hero
   * photograph. `AppSegmentedControl` shares this exact well (`segmentedSurface.ts`) and has always
   * been `inline-grid`, so the two widgets that deliberately share one surface disagreed about the
   * property that decides how that surface reads.
   *
   * `max-w-full` is asserted beside it because it is what keeps the scroll honest: a fit-width box
   * may exceed its parent, and a strip of six tabs has to scroll inside the page, not widen it.
   */
  it("sizes the horizontal well to its tabs, and never past its parent", () => {
    const strip = mountTabs("drivers").get('[role="tablist"]');
    expect(strip.classes()).toContain("w-fit");
    expect(strip.classes()).toContain("max-w-full");
  });

  /**
   * Every horizontal strip scrolls, and no tab gives up its line. Opt-in scrolling left Fleet report's
   * six tabs squeezed at 390 px — each label on three lines, the page 129 px wider than the phone
   * (US6b, 2026-10-13). A page cannot know the reader's width, so the strip does not ask it.
   */
  it("scrolls the horizontal strip rather than squeezing its tabs", () => {
    const w = mountTabs("drivers");
    expect(w.get('[role="tablist"]').classes()).toContain("overflow-x-auto");
    for (const tab of w.findAll('[role="tab"]')) {
      expect(tab.classes()).toContain("shrink-0");
      expect(tab.classes()).toContain("whitespace-nowrap");
    }
  });

  /** The vertical rail is a different object: it sits on the page ground and fills its column. */
  it("does not constrain the vertical rail's width", () => {
    const rail = mountTabs("drivers", { orientation: "vertical" }).get('[role="tablist"]');
    expect(rail.classes()).not.toContain("w-fit");
  });
});

/**
 * A strip that scrolls must show the tab it selected (Equipment's fourth tab, 390 px, 2026-10-30).
 * jsdom lays nothing out, so each tab is given a box: three 100 px tabs in a 150 px strip.
 */
describe("AppTabs keeps the selected tab on screen", () => {
  function laidOut(modelValue: string) {
    const geometry = (el: Element, left: number, width: number) => {
      Object.defineProperty(el, "offsetLeft", { configurable: true, get: () => left });
      Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => width });
    };
    const proto = HTMLElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "clientWidth");
    Object.defineProperty(proto, "clientWidth", { configurable: true, get() { return this.getAttribute("role") === "tablist" ? 150 : 0; } });
    const w = mountTabs(modelValue);
    w.findAll('[role="tab"]').forEach((t, i) => geometry(t.element, i * 100, 100));
    return { w, restore: () => (original ? Object.defineProperty(proto, "clientWidth", original) : delete (proto as { clientWidth?: number }).clientWidth) };
  }

  it("scrolls the strip to a selected tab past its edge, and only the strip", async () => {
    const { w, restore } = laidOut("drivers");
    const strip = w.get('[role="tablist"]').element as HTMLElement;
    await flushPromises();
    expect(strip.scrollLeft).toBe(0);
    await w.setProps({ modelValue: "audit" });
    await flushPromises();
    // The third tab ends at 300; a 150 px strip shows it from 150.
    expect(strip.scrollLeft).toBe(150);
    await w.setProps({ modelValue: "drivers" });
    await flushPromises();
    expect(strip.scrollLeft).toBe(0);
    restore();
  });

  it("scrolls only as far as the selected tab needs, not to its start", async () => {
    const { w, restore } = laidOut("drivers");
    const strip = w.get('[role="tablist"]').element as HTMLElement;
    await flushPromises();
    strip.scrollLeft = 40;
    await w.setProps({ modelValue: "exports" });
    await flushPromises();
    // Exports spans 100–200 and the view is 40–190, so it still moves — only by 10.
    expect(strip.scrollLeft).toBe(50);
    restore();
  });
});

