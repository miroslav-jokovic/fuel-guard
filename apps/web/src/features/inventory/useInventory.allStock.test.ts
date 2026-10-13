import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

/**
 * F3 (US6b): the label screen's shelves read was never sent. It called the shelf walk's query with no
 * location, which that query reads as "not chosen yet" and holds disabled. Every shelf, across
 * locations, is its own query now, and it asks the route with no location filter.
 */
const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    calls.push(url);
    return { ok: true, data: { lines: [], total: 0 } };
  }),
}));

import { useAllStockQuery } from "./useInventory";

describe("useAllStockQuery", () => {
  it("asks for every shelf, with no location filter", async () => {
    const C = defineComponent({ setup: () => (useAllStockQuery(), () => h("div")) });
    mount(C, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
    await flushPromises();
    expect(calls).toEqual(["/api/maintenance/inventory/stock"]);
  });
});
