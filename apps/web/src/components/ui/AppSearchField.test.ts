import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { AppSearchField } from "@fuelguard/ui";

describe("AppSearchField", () => {
  it("uses the custom clear control and marks the native search affordance for suppression", async () => {
    vi.useFakeTimers();
    const wrapper = mount(AppSearchField, {
      props: { modelValue: "driver", label: "Search drivers" },
    });

    const input = wrapper.get('input[type="search"]');
    expect(input.classes()).toContain("app-search-field-input");

    const clear = wrapper.get('button[aria-label="Clear search"]');
    expect(wrapper.findAll('button[aria-label="Clear search"]')).toHaveLength(1);
    await clear.trigger("click");

    expect((input.element as HTMLInputElement).value).toBe("");
    expect(wrapper.emitted("update:modelValue")).toEqual([[""]]);
    vi.useRealTimers();
  });
});
