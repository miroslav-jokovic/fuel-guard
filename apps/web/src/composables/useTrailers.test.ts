import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

/**
 * 2026-11-17: every active trailer carried its VIN in the database — the McLeod roster sweep writes
 * `dbo.trailer.serial_number` into `trailers.vin`, 234 of 234 measured on production — and no screen
 * showed one, because this read never asked for the column. The page tests mock this composable, so
 * they cannot see that omission; this one reads the column list the database is actually sent.
 */
const selects: string[] = [];
const chain = {
  select: (cols: string) => {
    selects.push(cols);
    return chain;
  },
  order: async () => ({ data: [], error: null }),
};
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => chain } }));

const { useTrailersQuery } = await import("./useTrailers");

describe("useTrailersQuery", () => {
  it("asks the database for each trailer's VIN", async () => {
    const C = defineComponent({ setup: () => { useTrailersQuery(); return () => h("div"); } });
    mount(C, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
    await flushPromises();
    expect(selects).toHaveLength(1);
    expect(selects[0]!.split(",").map((c) => c.trim())).toContain("vin");
  });
});
