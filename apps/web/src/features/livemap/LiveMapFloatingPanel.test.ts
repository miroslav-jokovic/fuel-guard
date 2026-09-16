import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LiveMapFloatingPanel from "./LiveMapFloatingPanel.vue";

/**
 * The floating panel primitive (D-DR6/D-DR9/D-DR10, DESIGN-REFRESH-2026-09.md §4).
 *
 * Two of its rules are load-bearing and neither is visible in a screenshot:
 *
 * 1. A shut panel stays in the DOM. The map canvas is a surface a screen reader cannot enter, so
 *    every route to a truck runs through the chrome around it — a panel that unmounted when
 *    dismissed would take its own reopen control with it and leave nothing behind but map.
 * 2. The panel grows out of the pill that opened it (`apple-design` §7). The origin is DERIVED from
 *    the corner, so a bottom-left panel cannot scale from a top-right corner it has never occupied.
 */
function mountPanel(props: Partial<InstanceType<typeof LiveMapFloatingPanel>["$props"]> = {}) {
  return mount(LiveMapFloatingPanel, {
    props: { title: "Fleet status", corner: "top-left", open: true, ...props } as never,
    slots: { default: "<p>54 moving</p>" },
    global: { stubs: { AppIcon: true } },
  });
}

describe("LiveMapFloatingPanel", () => {
  it("keeps the panel and its label in the DOM when it is shut, hidden rather than removed", () => {
    const wrapper = mountPanel({ open: false });
    const section = wrapper.find("section");

    expect(section.exists()).toBe(true);
    // `v-show`, so the element is present and styled away. `v-if` would delete the only keyboard
    // route to what the panel holds.
    expect(section.attributes("style")).toContain("display: none");
    expect(section.attributes("aria-label")).toBe("Fleet status");
    expect(wrapper.text()).toContain("54 moving");
  });

  it("leaves the pill as a labelled control reporting the panel's state either way", () => {
    const shut = mountPanel({ open: false });
    expect(shut.find("button").text()).toContain("Fleet status");
    expect(shut.find("button").attributes("aria-expanded")).toBe("false");

    const open = mountPanel({ open: true });
    expect(open.find("button").attributes("aria-expanded")).toBe("true");
  });

  it("asks its owner to toggle rather than deciding for itself", async () => {
    const wrapper = mountPanel({ open: true });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("anchors the panel to the corner it is pinned to, in both position and growth", () => {
    const topLeft = mountPanel({ corner: "top-left" });
    expect(topLeft.find("section").classes()).toContain("origin-top-left");

    const topRight = mountPanel({ corner: "top-right" });
    expect(topRight.find("section").classes()).toContain("origin-top-right");

    const bottomLeft = mountPanel({ corner: "bottom-left" });
    expect(bottomLeft.find("section").classes()).toContain("origin-bottom-left");
    // …and the pill sits below the panel there, so the panel opens UP out of it rather than
    // downwards off the bottom edge of the map.
    expect(bottomLeft.find("div").classes()).toContain("flex-col-reverse");
  });

  it("carries the translucent material class, which is what D-DR9 confines to this surface", () => {
    // `.map-panel` is the only `backdrop-filter` in the product and it answers
    // `prefers-reduced-transparency` and `prefers-contrast` in `style.css`. A panel that lost the
    // class would go transparent over a photograph with nothing to catch the loss.
    const wrapper = mountPanel();
    expect(wrapper.find("section").classes()).toContain("map-panel");
    expect(wrapper.find("button").classes()).toContain("map-panel");
  });
});
