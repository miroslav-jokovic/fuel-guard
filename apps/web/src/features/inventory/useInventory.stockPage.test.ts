import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

/**
 * The label screen's shelves (US6b F3, then F32).
 *
 * F3: the read was never sent — it called the shelf walk's query with no location, which that query
 * reads as "not chosen yet" and holds disabled. F32: once sent, it was ONE 200-line response searched
 * in the browser, so line 201 could not be reached. The page and the search are the route's now.
 */
const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    calls.push(url);
    return { ok: true, data: { lines: [], total: 0 } };
  }),
}));

import { useStockPageQuery } from "./useInventory";

const ask = async (filter: { page: number; search?: string }) => {
  calls.length = 0;
  const C = defineComponent({ setup: () => (useStockPageQuery(ref(filter)), () => h("div")) });
  mount(C, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
  await flushPromises();
  return calls;
};

describe("useStockPageQuery", () => {
  it("asks for every location's shelves, one page of twenty at a time", async () => {
    expect(await ask({ page: 1 })).toEqual(["/api/maintenance/inventory/stock?limit=20&offset=0"]);
    expect(await ask({ page: 3 })).toEqual(["/api/maintenance/inventory/stock?limit=20&offset=40"]);
  });

  it("hands the search to the server", async () => {
    expect(await ask({ page: 1, search: "oil filter" })).toEqual([
      "/api/maintenance/inventory/stock?limit=20&offset=0&search=oil+filter",
    ]);
  });
});
