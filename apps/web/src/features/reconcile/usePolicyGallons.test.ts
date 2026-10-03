import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";

/**
 * `fuel_policy_gallons` (0416) feeds Buy discipline's two target figures. These pin what the hook sends and
 * what it hands on: no org in the request (the JWT scopes a browser), null rather than an empty array when
 * no truck is picked, numeric gallons although PostgREST sends `numeric` as a string, a null brand kept as a
 * null (it counts off-network downstream), and paging past the 1,000-row cap.
 */
const calls: { fn: string; args: Record<string, unknown>; range: [number, number][] } = { fn: "", args: {}, range: [] };
let total = 0;
const cell = (i: number) => ({ month: "2026-08", brand: i === 0 ? null : `b${i}`, state: "TX", gallons: i === 0 ? "12.500" : "100.000", fills: 1 });
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.fn = fn;
      calls.args = args;
      return {
        range: async (start: number, end: number) => {
          calls.range.push([start, end]);
          const n = Math.max(0, Math.min(end + 1, total) - start);
          return { data: Array.from({ length: n }, (_, i) => cell(start + i)), error: null };
        },
      };
    },
  },
}));

import { usePolicyGallonsQuery } from "./usePolicyGallons";

beforeEach(() => {
  calls.fn = "";
  calls.args = {};
  calls.range = [];
  total = 3;
});

async function read(vehicleIds: string[] = []) {
  let out: ReturnType<typeof usePolicyGallonsQuery> | null = null;
  const Host = defineComponent({
    setup() {
      out = usePolicyGallonsQuery(ref({ from: "2026-07-06", to: "2026-10-03", vehicleIds }));
      return () => null;
    },
  });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] } });
  await flushPromises();
  return out!.data.value!;
}

describe("usePolicyGallonsQuery", () => {
  it("calls the function with the window, no org, and null for no trucks", async () => {
    await read();
    expect(calls.fn).toBe("fuel_policy_gallons");
    expect(calls.args).toEqual({ p_from: "2026-07-06", p_to: "2026-10-03", p_vehicles: null });
    expect(calls.args).not.toHaveProperty("p_org");
  });

  it("passes the picked trucks through", async () => {
    await read(["v1", "v2"]);
    expect(calls.args.p_vehicles).toEqual(["v1", "v2"]);
  });

  it("hands on numeric gallons, and an unresolved station as a null brand", async () => {
    const cells = await read();
    expect(cells).toHaveLength(3);
    expect(cells[0]).toEqual({ month: "2026-08", brand: null, state: "TX", gallons: 12.5 });
    expect(cells[1]).toEqual({ month: "2026-08", brand: "b1", state: "TX", gallons: 100 });
    expect(typeof cells[1]!.gallons).toBe("number");
  });

  it("pages past PostgREST's 1,000-row cap and returns every cell once", async () => {
    total = 2300;
    const cells = await read();
    expect(cells).toHaveLength(2300);
    expect(calls.range).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});
