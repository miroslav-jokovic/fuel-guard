import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppTabs from "./components/AppTabs.vue";
import AppSegmentedControl from "./components/AppSegmentedControl.vue";
import {
  SEGMENTED_IDLE,
  SEGMENTED_SEGMENT,
  SEGMENTED_SELECTED,
  SEGMENTED_WELL,
} from "./segmentedSurface";

/**
 * The shared well-and-pill recipe (D-DT16).
 *
 * ⚠ What is pinned is that the two widgets READ the recipe rather than agree with it by
 * coincidence — which is the state this replaced, and which had already produced one silent
 * divergence (`shadow-card` on the segmented control's pill, absent from the tab strip's). A test
 * that asserted the class strings themselves would pass just as happily against two copies, so
 * every expectation below is derived from the exported constant and never restates it.
 *
 * Each assertion was proved to fail by mutation, 2026-09-20: dropping `SEGMENTED_WELL` from either
 * template, and hand-writing `bg-surface-muted` back into one of them, both go red here.
 */
const classesOf = (recipe: string) => recipe.split(" ");

const tabs = (modelValue = "drivers", props: Record<string, unknown> = {}) =>
  mount(AppTabs, {
    props: {
      modelValue,
      tabs: [
        { value: "drivers", label: "Drivers" },
        { value: "exports", label: "Exports" },
      ],
      label: "Qualification view",
      ...props,
    },
  });

const segments = (modelValue = "view", props: Record<string, unknown> = {}) =>
  mount(AppSegmentedControl, {
    props: {
      modelValue,
      options: [
        { value: "none", label: "None" },
        { value: "view", label: "View" },
      ],
      label: "Fuel access",
      ...props,
    },
  });

describe("segmented surface", () => {
  it("draws both widgets on one well, not on two copies of one", () => {
    const strip = tabs().get('[role="tablist"]').classes();
    const group = segments().get('[role="radiogroup"]').classes();
    for (const cls of classesOf(SEGMENTED_WELL)) {
      expect(strip).toContain(cls);
      expect(group).toContain(cls);
    }
  });

  /**
   * The de-grey (D-DT16): the ground is `--control-well`, and `--surface-muted` — what a well used
   * to be — must not survive anywhere on either strip.
   */
  it("has no grey well left in either widget", () => {
    for (const wrapper of [tabs(), segments()]) {
      expect(wrapper.html()).toContain("bg-control-well");
      expect(wrapper.html()).not.toContain("bg-surface-muted");
    }
  });

  it("raises the selected segment the same way in both", () => {
    const selectedTab = tabs("exports").findAll('[role="tab"]')[1]!.classes();
    const selectedSegment = segments("view").findAll('[role="radio"]')[1]!.classes();
    for (const cls of classesOf(SEGMENTED_SELECTED)) {
      expect(selectedTab).toContain(cls);
      expect(selectedSegment).toContain(cls);
    }
  });

  it("gives every unselected segment the same idle ink", () => {
    const idleTab = tabs("exports").findAll('[role="tab"]')[0]!.classes();
    const idleSegment = segments("view").findAll('[role="radio"]')[0]!.classes();
    for (const cls of classesOf(SEGMENTED_IDLE)) {
      expect(idleTab).toContain(cls);
      expect(idleSegment).toContain(cls);
    }
  });

  it("gives every segment the same face and focus ring", () => {
    const anyTab = tabs().findAll('[role="tab"]')[0]!.classes();
    const anySegment = segments().findAll('[role="radio"]')[0]!.classes();
    for (const cls of classesOf(SEGMENTED_SEGMENT)) {
      expect(anyTab).toContain(cls);
      expect(anySegment).toContain(cls);
    }
  });

  /**
   * ⚠ The two states the recipe deliberately does NOT own, pinned so a later tidy-up cannot fold
   * them in by accident. A vertical rail is not a strip — it sits on the page ground and marks its
   * selection with `--selected-surface` — and an `inherited` segment is outlined rather than
   * filled precisely so it does not claim this control decided the value.
   */
  it("leaves the vertical rail and the inherited segment off the pill", () => {
    const rail = tabs("drivers", { orientation: "vertical" });
    expect(rail.get('[role="tablist"]').classes()).not.toContain("bg-control-well");
    expect(rail.findAll('[role="tab"]')[0]!.classes()).toContain("bg-selected-surface");

    const inherited = segments("view", { inherited: true }).findAll('[role="radio"]')[1]!;
    expect(inherited.classes()).toContain("ring-edge-strong");
    expect(inherited.classes()).not.toContain("bg-surface");
  });
});
