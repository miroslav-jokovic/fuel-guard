import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
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
});
