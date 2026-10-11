import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, type Component } from "vue";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import AppButton from "./components/AppButton.vue";
import AppCheckbox from "./components/AppCheckbox.vue";
import AppCombobox from "./components/AppCombobox.vue";
import AppDateField from "./components/AppDateField.vue";
import AppIconButton from "./components/AppIconButton.vue";
import AppInput from "./components/AppInput.vue";
import AppRadioGroup from "./components/AppRadioGroup.vue";
import AppSegmentedControl from "./components/AppSegmentedControl.vue";
import AppSelect from "./components/AppSelect.vue";
import { CalendarIcon } from "./icons";
import { provideTouchTargets } from "./touchTargets";

/**
 * The touch floor (`touchTargets.ts`, C3d3b2): inside a providing layout every primitive's compact size
 * is 44 px; outside one, nothing moves. Both halves are asserted for each primitive, because the second
 * is the promise to the office — a floor that leaked out of `/apply` would re-space every table in the
 * product. `e2e-apply/tapTargets.spec.ts` measures the pixels; this pins which class says so.
 */
enableAutoUnmount(afterEach);

function mountIn(touch: boolean, comp: Component, props: Record<string, unknown> = {}, slot?: string) {
  const Host = defineComponent({
    setup() {
      if (touch) provideTouchTargets();
      return () => h(comp, props, slot ? { default: () => slot } : undefined);
    },
  });
  return mount(Host, { attachTo: document.body });
}

describe("the touch floor", () => {
  it("raises a button's sm and md to 44 px, and leaves them at 32 and 36 outside", () => {
    for (const size of ["sm", "md"]) {
      expect(mountIn(true, AppButton, { size }, "Go").find("button").classes()).toContain("h-11");
      expect(mountIn(false, AppButton, { size }, "Go").find("button").classes()).not.toContain("h-11");
    }
    expect(mountIn(false, AppButton, { size: "md" }, "Go").find("button").classes()).toContain("h-9");
  });

  it("makes a square button 44 px and gives a list row a 44 px floor", () => {
    expect(mountIn(true, AppButton, { size: "icon" }, "x").find("button").classes()).toContain("size-11");
    expect(mountIn(false, AppButton, { size: "icon" }, "x").find("button").classes()).toContain("size-8");
    expect(mountIn(true, AppButton, { size: "row" }, "A row").find("button").classes()).toContain("min-h-11");
    expect(mountIn(false, AppButton, { size: "row" }, "A row").find("button").classes()).not.toContain("min-h-11");
  });

  // WCAG 2.5.8 exempts a target inside a sentence; a 44 px box would break the line it sits in.
  it("never gives an inline link a box", () => {
    const cls = mountIn(true, AppButton, { variant: "link" }, "use it").find("button").classes();
    expect(cls).toContain("h-auto");
    expect(cls).not.toContain("h-11");
  });

  it("raises a text box, a select and a combobox's input to 44 px", () => {
    expect(mountIn(true, AppInput).find("input").classes()).toContain("h-11");
    expect(mountIn(false, AppInput).find("input").classes()).toContain("h-9");
    expect(mountIn(true, AppSelect, { modelValue: null, options: [] }).find("select").classes()).toContain("h-11");
    expect(mountIn(false, AppSelect, { modelValue: null, options: [] }).find("select").classes()).toContain("h-9");
    expect(mountIn(true, AppCombobox, { modelValue: "", options: [] }).find("input").classes()).toContain("h-11");
  });

  it("makes a combobox's options 44 px rows, which the list is teleported out of the layout to show", async () => {
    const options = [{ value: "IL", label: "Illinois" }];
    for (const touch of [true, false]) {
      const w = mountIn(touch, AppCombobox, { modelValue: "", options });
      await w.find("input").trigger("click");
      const option = document.body.querySelector("[role=option]")!;
      expect(option.classList.contains("min-h-11")).toBe(touch);
      w.unmount();
    }
  });

  it("makes every checkbox and every radio a 44 px row, asked or not, and keeps `touch` working outside", () => {
    expect(mountIn(true, AppCheckbox, {}, "I agree").find("label").classes()).toContain("min-h-11");
    expect(mountIn(false, AppCheckbox, {}, "I agree").find("label").classes()).toContain("min-h-9");
    expect(mountIn(false, AppCheckbox, { size: "touch" }, "I agree").find("label").classes()).toContain("min-h-11");
    const radios = { legend: "Class", options: [{ value: "A", label: "A" }] };
    expect(mountIn(true, AppRadioGroup, radios).find("label").classes()).toContain("min-h-11");
    expect(mountIn(false, AppRadioGroup, radios).find("label").classes()).toContain("min-h-9");
  });

  it("makes a segment and an icon button 44 px", () => {
    const seg = { modelValue: "a", label: "How", options: [{ value: "a", label: "A" }] };
    expect(mountIn(true, AppSegmentedControl, seg).find("[role=radio]").classes()).toContain("min-h-11");
    expect(mountIn(false, AppSegmentedControl, seg).find("[role=radio]").classes()).toContain("min-h-8");
    const icon = { icon: CalendarIcon, label: "Pick" };
    expect(mountIn(true, AppIconButton, icon).find("button").classes()).toContain("size-11");
    expect(mountIn(false, AppIconButton, icon).find("button").classes()).toContain("size-9");
  });

  it("makes a date field's input 44 px and its calendar button 44 px wide", () => {
    const inside = mountIn(true, AppDateField, { modelValue: "" });
    expect(inside.find("input").classes()).toContain("h-11");
    expect(inside.find("button[aria-label='Choose a date']").classes()).toContain("w-11");
    const outside = mountIn(false, AppDateField, { modelValue: "" });
    expect(outside.find("input").classes()).toContain("h-9");
    expect(outside.find("button[aria-label='Choose a date']").classes()).toContain("w-9");
  });
});
