import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, ref } from "vue";

/**
 * The Fuel Log windows on the DAY, not on the instant (FUEL-T1, D-FUI11).
 *
 * The defect was not a wrong value anywhere — it was two derivations of one day. The table rendered
 * `fueled_at` in the station's zone; the filter compared that same instant as UTC. Measured in
 * production 2026-09-01: 1,833 of 14,749 fills (12.4%) display a different calendar date than the
 * filter used, and 57 of them ($28,430.70) sat in the neighbouring MONTH.
 *
 * These assertions are on the QUERY rather than on rows, because the query is the whole change: the
 * column it filters is the contract, and `business_date` (migration 0287) is the same derivation the
 * display uses instead of a second opinion about it.
 */

interface Call { method: string; args: unknown[] }
const calls: Call[] = [];

function recorder(): unknown {
  const target = {
    then(resolve: (v: unknown) => void) {
      resolve({ data: [], error: null, count: 0 });
    },
  };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop === "then") return (t as { then: unknown }).then;
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return recorder();
      };
    },
  });
}

// `rpc` records its arguments and answers one row, the shape `returns table` gives PostgREST. Added at
// FUEL-T3a: the tiles' four summed figures now come from `fuel_range_totals` (migration 0289) instead
// of the paging loop, so a mock with no `rpc` makes the totals query throw before it filters anything —
// which is how this suite first reported the change as a windowing regression it was not.
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => { calls.push({ method: "from", args: [table] }); return recorder(); },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: [{ fills: 0, gallons: 0, spend: 0, has_cost: false, flagged: 0, clear: 0 }], error: null };
    },
  },
}));

vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ orgId: "org-1" }) }));

import { useFuelTransactions, useFuelRangeTotals, type FuelFilters } from "./useFuelLog";

async function run(composable: "list" | "totals", filters: FuelFilters) {
  const Host = defineComponent({
    setup() {
      const f = ref(filters);
      if (composable === "list") useFuelTransactions(f, ref(1));
      else useFuelRangeTotals(f);
      return () => null;
    },
  });
  mount(Host, { global: { plugins: [VueQueryPlugin] } });
  await flushPromises();
  await flushPromises();
}

const filtersFor = (m: string, col: string) =>
  calls.filter((c) => c.method === m && c.args[0] === col).map((c) => c.args[1]);

beforeEach(() => { calls.length = 0; rpcCalls.length = 0; });

describe("the fuel window is a window of days", () => {
  it("the list filters business_date, inclusive at both ends, with the days as picked", async () => {
    await run("list", { from: "2026-08-01", to: "2026-08-31" });
    expect(filtersFor("gte", "business_date")).toEqual(["2026-08-01"]);
    expect(filtersFor("lte", "business_date")).toEqual(["2026-08-31"]);
  });

  // The regression that would undo the whole step: going back to the instant.
  it("the list no longer windows on the fueled_at instant", async () => {
    await run("list", { from: "2026-08-01", to: "2026-08-31" });
    expect(filtersFor("gte", "fueled_at")).toEqual([]);
    expect(filtersFor("lte", "fueled_at")).toEqual([]);
  });

  it("the tiles window on exactly the same column as the rows beneath them", async () => {
    await run("totals", { from: "2026-08-01", to: "2026-08-31" });
    // Every tile now goes through SQL — the sums via `fuel_range_totals` (0289) and the odometer /
    // MPG measurements via `fuel_range_miles_inputs` (0290), both windowing on `business_date` there.
    // So the days are asserted on the arguments BOTH were given: one of them drifting would put two
    // halves of the same tile row on different windows, which is the disagreement T3a/T3b end.
    expect(rpcCalls.map((c) => c.fn).sort()).toEqual(["fuel_range_miles_inputs", "fuel_range_totals"]);
    for (const c of rpcCalls) {
      expect(c.args).toMatchObject({ p_from: "2026-08-01", p_to: "2026-08-31" });
    }
    // …and the tiles no longer read `fuel_transactions` at all, so there is no client-side window left
    // to get wrong.
    expect(calls.filter((c) => c.method === "from")).toEqual([]);
  });

  // `fueled_at` keeps the job it is good at — ordering and time-of-day — and only loses the filter.
  it("fueled_at still orders the log", async () => {
    await run("list", { from: "2026-08-01", to: "2026-08-31" });
    expect(calls.some((c) => c.method === "order" && c.args[0] === "fueled_at")).toBe(true);
  });
});
