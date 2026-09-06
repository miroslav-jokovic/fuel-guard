import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppSegmentedControl from "./AppSegmentedControl.vue";

/**
 * `AppSegmentedControl` — a radio group drawn as one strip.
 *
 * What is pinned is the contract a screen reader and a keyboard are promised by `role="radiogroup"`:
 * one segment in the tab order, arrows moving the choice, and a real `aria-checked`. The visual
 * `inherited` state is pinned too, because it is the one thing a caller can get subtly wrong — an
 * outlined segment must still be a working choice, or the permissions page's "follow their role"
 * rows would be read-only by accident.
 */
const OPTIONS = [
  { value: "none", label: "None" },
  { value: "view", label: "View" },
  { value: "manage", label: "Manage" },
];

const mountControl = (modelValue = "view", props: Record<string, unknown> = {}) =>
  mount(AppSegmentedControl, {
    props: { modelValue, options: OPTIONS, label: "Fuel access", ...props },
    attachTo: document.body,
  });

describe("AppSegmentedControl", () => {
  it("is a radio group with exactly one segment in the tab order — the chosen one", () => {
    const w = mountControl("manage");
    expect(w.get('[role="radiogroup"]').attributes("aria-label")).toBe("Fuel access");
    expect(w.findAll('[role="radio"]').map((b) => b.attributes("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(w.findAll('[role="radio"]').map((b) => b.attributes("tabindex"))).toEqual(["-1", "-1", "0"]);
  });

  it("emits the clicked value and nothing on a click of the current one is still a choice", async () => {
    const w = mountControl("view");
    await w.findAll('[role="radio"]')[2]!.trigger("click");
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["manage"]);
  });

  it("moves the choice with the arrow keys and wraps at both ends", async () => {
    const w = mountControl("manage");
    await w.get('[role="radiogroup"]').trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["none"]);

    const first = mountControl("none");
    await first.get('[role="radiogroup"]').trigger("keydown", { key: "ArrowLeft" });
    expect(first.emitted("update:modelValue")?.at(-1)).toEqual(["manage"]);
  });

  it("leaves keys it does not handle alone, so Tab still leaves the widget", async () => {
    const w = mountControl("view");
    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    w.get('[role="radiogroup"]').element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("emits nothing while disabled", async () => {
    const w = mountControl("view", { disabled: true });
    await w.findAll('[role="radio"]')[0]!.trigger("click");
    await w.get('[role="radiogroup"]').trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("keeps an inherited value a working choice, only drawn outlined", async () => {
    const w = mountControl("view", { inherited: true });
    const chosen = w.findAll('[role="radio"]')[1]!;
    expect(chosen.attributes("aria-checked")).toBe("true");
    expect(chosen.classes()).toContain("ring-1");
    expect(chosen.classes()).not.toContain("bg-surface");
    await chosen.trigger("click");
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["view"]);
  });
});
