import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import AppRadioGroup from "./AppRadioGroup.vue";

/**
 * `pick`: a choice TAPPED, which a page may move on at (APPLICATION-FIX-PLAN U3) — and never a choice
 * reached with the keyboard, which a browser also reports as a click on the radio.
 */
const OPTIONS = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const group = ({ attachTo, ...props }: Record<string, unknown> = {}) =>
  mount(AppRadioGroup, { props: { legend: "Any?", options: OPTIONS, ...props }, ...(attachTo ? { attachTo: attachTo as HTMLElement } : {}) });
const tap = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const key = (el: Element, type: "keydown" | "keyup") => el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: "ArrowDown" }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a choice that was tapped", () => {
  it("says so once, whether the radio or its label was tapped", () => {
    const w = group({ attachTo: document.body });
    tap(w.findAll("input")[0]!.element);
    vi.runAllTimers();
    expect(w.emitted("pick")).toEqual([["yes"]]);
    // A tap on the label is the browser clicking its radio.
    w.findAll("label")[1]!.element.click();
    vi.runAllTimers();
    expect(w.emitted("pick")).toEqual([["yes"], ["no"]]);
    w.unmount();
  });

  it("says nothing for a choice reached with the keyboard, and hears a tap again once the key is up", () => {
    const w = group();
    const [first, second] = w.findAll("input").map((i) => i.element);
    // An arrow key: the key goes down on the radio in focus, and the browser clicks the next one.
    key(first!, "keydown");
    tap(second!);
    vi.runAllTimers();
    expect(w.emitted("pick")).toBeUndefined();
    key(second!, "keyup");
    tap(second!);
    vi.runAllTimers();
    expect(w.emitted("pick")).toEqual([["no"]]);
  });

  it("says so again for the choice already chosen, and never for a disabled one", () => {
    const w = group({ modelValue: "yes" });
    tap(w.findAll("input")[0]!.element);
    vi.runAllTimers();
    expect(w.emitted("pick")).toEqual([["yes"]]);
    const off = group({ options: [{ ...OPTIONS[0]!, disabled: true }, OPTIONS[1]!] });
    tap(off.findAll("input")[0]!.element);
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
