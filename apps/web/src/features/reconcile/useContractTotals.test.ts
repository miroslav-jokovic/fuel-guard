import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";

/**
 * `fuel_contract_totals` (0418) feeds the "Paid vs Pilot quote" tile. These pin what the hook sends and hands on:
 * no org in the request (the JWT scopes a browser), null rather than [] for no trucks, numbers although PostgREST
 * sends `numeric` as strings, and a missing row treated as a FAILED call — an aggregate always answers, and zero
 * fuel would read as "no fill matched a quote" about a request that never ran.
 */
const calls: { fn: string; args: Record<string, unknown> } = { fn: "", args: {} };
let reply: { data: unknown; error: { message: string } | null } = { data: [], error: null };
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.fn = fn;
      calls.args = args;
      return reply;
    },
  },
}));

import { useContractTotalsQuery } from "./useContractTotals";

const ROW = {
  measured_lines: 3754, measured_gallons: "801234.500", measured_paid: "2442173.23", measured_expected: "2441594.698770",
  unmeasured_lines: 1902, unmeasured_paid: "1077332.78",
};
beforeEach(() => {
  calls.fn = "";
  calls.args = {};
  reply = { data: [ROW], error: null };
});

async function read(vehicleIds: string[] = []) {
  let out: ReturnType<typeof useContractTotalsQuery> | null = null;
  const Host = defineComponent({
    setup() {
      out = useContractTotalsQuery(ref({ from: "2026-07-06", to: "2026-10-03", vehicleIds }));
      return () => null;
    },
  });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] } });
  await flushPromises();
  return out!;
}

describe("useContractTotalsQuery", () => {
  it("calls the function with the window, no org, and null for no trucks", async () => {
    await read();
    expect(calls.fn).toBe("fuel_contract_totals");
    expect(calls.args).toEqual({ p_from: "2026-07-06", p_to: "2026-10-03", p_vehicles: null });
    expect(calls.args).not.toHaveProperty("p_org");
  });

  it("passes the picked trucks through", async () => {
    await read(["v1"]);
    expect(calls.args.p_vehicles).toEqual(["v1"]);
  });

  it("hands on numbers, from the strings PostgREST sends", async () => {
    const t = (await read()).data.value!;
    expect(t).toEqual({
      measuredLines: 3754, measuredGallons: 801234.5, measuredPaid: 2442173.23, measuredExpected: 2441594.69877,
      unmeasuredLines: 1902, unmeasuredPaid: 1077332.78,
    });
  });

  it("fails, rather than reading zero fuel, when the answer has no row", async () => {
    reply = { data: [], error: null };
    const q = await read();
    expect(q.isError.value).toBe(true);
    expect(q.data.value).toBeUndefined();
  });

  it("fails when the call errors", async () => {
    reply = { data: null, error: { message: "canceling statement due to statement timeout" } };
    const q = await read();
    expect(q.isError.value).toBe(true);
  });
});
