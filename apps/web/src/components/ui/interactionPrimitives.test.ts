import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { AppSelect } from "@fuelguard/ui";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import FilterSelect from "./FilterSelect.vue";
import DateRangeFilter from "../DateRangeFilter.vue";

vi.mock("@floating-ui/vue", () => ({
  useFloating: () => ({ floatingStyles: {} }),
  offset: () => undefined,
  flip: () => undefined,
  shift: () => undefined,
  autoUpdate: () => undefined,
}));

afterEach(() => document.body.replaceChildren());

const options = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
  { value: "three", label: "Three" },
];

describe("shared form controls", () => {
  it("preserves typed option values through the native select keyboard contract", async () => {
    const wrapper = mount(AppSelect, {
      props: {
        modelValue: 1,
        options: [
          { value: 1, label: "Monday" },
          { value: 0, label: "Sunday" },
        ],
      },
    });

    await wrapper.get("select").setValue("0");
    expect(wrapper.emitted("update:modelValue")).toEqual([[0]]);
  });

  it("supports arrows, Home/End, Enter, and Escape in the combobox", async () => {
    const wrapper = mount(ComboSelect, { props: { modelValue: "", options } });
    const input = wrapper.get("input");

    await input.trigger("focus");
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "End" });
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")).toEqual([["three"]]);

    await input.trigger("focus");
    await input.setValue("tw");
    await input.trigger("keydown", { key: "Escape" });
    expect(wrapper.find("[role='listbox']").exists()).toBe(false);
  });

  it("keeps filter clear as a sibling control and supports arrow entry into options", async () => {
    const wrapper = mount(FilterSelect, {
      attachTo: document.body,
      props: { modelValue: "two", label: "Risk", options },
      global: { stubs: { Teleport: true } },
    });

    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.element.contains(buttons[1]!.element)).toBe(false);
    await buttons[0]!.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.find("[role='listbox']").exists()).toBe(true);
    await buttons[1]!.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([[""]]);
  });

  it("keeps the date clear action outside the date-picker trigger", async () => {
    const wrapper = mount(DateRangeFilter, {
      props: { from: "2026-08-01", to: "2026-08-11" },
      global: {
        stubs: {
          VueDatePicker: { template: "<div class='picker'><slot name='trigger' /></div>" },
        },
      },
    });

    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.element.contains(buttons[1]!.element)).toBe(false);
    await buttons[1]!.trigger("click");
    expect(wrapper.emitted("update:from")).toEqual([[undefined]]);
    expect(wrapper.emitted("update:to")).toEqual([[undefined]]);
  });
});
