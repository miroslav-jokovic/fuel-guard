import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import AppRadioGroup from "./AppRadioGroup.vue";

/**
 * `pick`: a choice TAPPED, which a page may move on at (APPLICATION-FIX-PLAN U3) — and never a choice
 * arrowed to, which a browser also reports as a click, with `detail` 0.
 */
const OPTIONS = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const group = (props: Record<string, unknown> = {}) => mount(AppRadioGroup, { props: { legend: "Any?", options: OPTIONS, ...props } });
const tap = (el: Element, detail: number) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a choice that was tapped", () => {
  it("says so once, though a tap on the label is reported on the label and again on its radio", () => {
    const w = group();
    const label = w.findAll("label")[0]!.element;
    tap(label, 1);
    tap(label.querySelector("input")!, 1);
    vi.runAllTimers();
    expect(w.emitted("pick")).toEqual([["yes"]]);
  });

  it("says nothing for a choice arrowed to with the keyboard", () => {
    const w = group();
    tap(w.findAll("input")[1]!.element, 0);
    vi.runAllTimers();
    expect(w.emitted("pick")).toBeUndefined();
  });

  it("says so again for the choice already chosen, and never for a disabled one", () => {
    const w = group({ modelValue: "yes" });
    tap(w.findAll("label")[0]!.element, 1);
    vi.runAllTimers();
    expect(w.emitted("pick")).toEqual([["yes"]]);
    const off = group({ disabled: true });
    tap(off.findAll("label")[0]!.element, 1);
    vi.runAllTimers();
    expect(off.emitted("pick")).toBeUndefined();
  });
});

describe("choices drawn as cards", () => {
  it("are blocks the whole of which is the target, side by side when asked, and still radios", () => {
    const w = group({ variant: "cards", columns: 2 });
    expect(w.find("fieldset > div").classes()).toEqual(expect.arrayContaining(["grid", "grid-cols-2"]));
    for (const label of w.findAll("label")) expect(label.classes()).toContain("min-h-14");
    expect(w.findAll("input[type=radio]")).toHaveLength(2);
  });

  it("stay the list by default, so no other screen changed", () => {
    const w = group({ size: "touch" });
    for (const label of w.findAll("label")) expect(label.classes()).toContain("min-h-12");
    expect(w.find("fieldset > div").classes()).not.toContain("grid");
  });
});
