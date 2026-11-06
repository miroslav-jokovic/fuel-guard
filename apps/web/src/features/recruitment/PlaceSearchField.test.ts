import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { AppCombobox } from "@silvicom/ui";
import PlaceSearchField from "./PlaceSearchField.vue";

/** The opening's place search (Q-AD44 (a)): recruiting's own door, asked after a pause, and the pick carries its point. */
const api = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    api.calls.push(path);
    return { ok: true, data: { suggestions: [{ label: "Joliet, IL, United States", lat: 41.525, lng: -88.0817 }] } };
  }),
}));

describe("PlaceSearchField", () => {
  it("asks recruiting's place search for what was typed, and emits the picked place with its point", async () => {
    const w = mount(PlaceSearchField, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
    const combo = w.findComponent(AppCombobox);
    combo.vm.$emit("update:query", "Jo");
    combo.vm.$emit("update:query", "Joliet");
    await new Promise((r) => setTimeout(r, 400));
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(api.calls).toEqual(["/api/recruitment/place-suggest?q=Joliet"]);
    combo.vm.$emit("update:modelValue", "0");
    expect(w.emitted("select")).toEqual([[{ label: "Joliet, IL, United States", lat: 41.525, lng: -88.0817 }]]);
  });
});
