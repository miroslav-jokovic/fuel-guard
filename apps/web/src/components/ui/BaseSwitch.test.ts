import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import BaseSwitch from "./BaseSwitch.vue";

describe("BaseSwitch", () => {
  it("exposes switch state and emits the next value", async () => {
    const wrapper = mount(BaseSwitch, { props: { modelValue: false }, attrs: { "aria-label": "Messages" } });

    expect(wrapper.attributes("role")).toBe("switch");
    expect(wrapper.attributes("aria-checked")).toBe("false");
    await wrapper.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([[true]]);
  });

  it("does not change when disabled", async () => {
    const wrapper = mount(BaseSwitch, { props: { modelValue: true, disabled: true } });

    await wrapper.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });
});
