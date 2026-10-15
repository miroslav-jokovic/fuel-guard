import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { StockLineDto } from "@silvicom/shared";

/**
 * The shelf walk's read of one bay. It was one `/stock` request, which the route answers with its
 * first 200 lines, so a bay holding line 201 walked as "Every line is counted" with bins unseen.
 */
const state = vi.hoisted(() => ({ calls: [] as string[], shelf: 0, failAt: -1 }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    state.calls.push(url);
    const q = new URL(url, "http://x").searchParams;
    const offset = Number(q.get("offset") ?? 0);
    if (offset === state.failAt) return { ok: false, error: { message: "Could not load stock" } };
    // The route's own ceiling: 200 a response, whatever was asked for.
    const limit = Math.min(Number(q.get("limit") ?? 200), 200);
    const n = Math.max(0, Math.min(limit, state.shelf - offset));
    const lines = Array.from({ length: n }, (_, i) => ({ partId: `p${offset + i}`, locationId: "bay" }));
    return { ok: true, data: { lines, total: state.shelf } };
  }),
}));

import { useStockQuery } from "./useInventory";

const walk = async (shelf: number, failAt = -1) => {
  Object.assign(state, { calls: [], shelf, failAt });
  let result!: ReturnType<typeof useStockQuery>;
  const C = defineComponent({ setup: () => ((result = useStockQuery(ref("bay"))), () => h("div")) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(C, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  await flushPromises();
  return { lines: (result.data.value?.lines ?? []) as StockLineDto[], failed: result.isError.value };
};

describe("useStockQuery reads a whole bay", () => {
  it("reads past the route's 200-line page to the last line", async () => {
    const { lines } = await walk(450);
    expect(lines).toHaveLength(450);
    expect(new Set(lines.map((l) => l.partId)).size).toBe(450);
    expect(state.calls).toEqual([
      "/api/maintenance/inventory/stock?locationId=bay&limit=200&offset=0",
      "/api/maintenance/inventory/stock?locationId=bay&limit=200&offset=200",
      "/api/maintenance/inventory/stock?locationId=bay&limit=200&offset=400",
    ]);
  });

  it("stops after one request when the bay fits on a page", async () => {
    expect((await walk(3)).lines).toHaveLength(3);
    expect(state.calls).toHaveLength(1);
  });

  it("fails the whole read when a later page fails, never a shelf cut short", async () => {
    const { lines, failed } = await walk(450, 200);
    expect(failed).toBe(true);
    expect(lines).toEqual([]);
  });
});
