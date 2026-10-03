import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, nextTick, ref, type Ref } from "vue";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";

/**
 * Q-FSV18: Buy discipline's quote tile no longer needs every spend line until it is opened, so
 * `useSpendLinesQuery` takes an `enabled` switch. If it did not hold, the page would quietly go back to
 * downloading nine seconds of rows nobody had asked for. These pin the switch, and that the default is on, as
 * every other caller assumes.
 */
let rpcCalls = 0;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => ({
      range: async () => {
        rpcCalls += 1;
        return { data: [], error: null };
      },
    }),
  },
}));

import { useSpendLinesQuery } from "./useSpendLines";

beforeEach(() => {
  rpcCalls = 0;
});

const mountWith = (enabled?: Ref<boolean>) => {
  const Host = defineComponent({
    setup() {
      const filters = ref({ from: "2026-07-06", to: "2026-10-03", vehicleIds: [] as string[] });
      if (enabled) useSpendLinesQuery(filters, enabled);
      else useSpendLinesQuery(filters);
      return () => null;
    },
  });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] } });
};

describe("useSpendLinesQuery enabled", () => {
  it("is on when no switch is given", async () => {
    mountWith();
    await flushPromises();
    expect(rpcCalls).toBe(1);
  });

  it("reads nothing while the switch is off, and reads once it is turned on", async () => {
    const on = ref(false) as Ref<boolean>;
    mountWith(on);
    await flushPromises();
    expect(rpcCalls).toBe(0);
    on.value = true;
    await nextTick();
    await flushPromises();
    expect(rpcCalls).toBe(1);
  });
});
