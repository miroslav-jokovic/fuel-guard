import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, ref } from "vue";

/**
 * The Fuel Log's tiles: four figures summed in the database, two still derived in TypeScript
 * (FUEL-T3a, migration 0289, D-AG1).
 *
 * WHY THE SPLIT IS THE WHOLE TEST. These six tiles used to be accumulated by a loop that pages
 * `fuel_transactions` 1,000 rows at a time until a short page arrives. That is correct only while the
 * loop is allowed to finish, and PostgREST's `max_rows` is a server setting this code does not control
 * — a carrier holding 14,500 fills is already fifteen round trips into it. If that ceiling moves, every
 * tile reads LOW with no error beside it.
 *
 * So `fills`, `gallons`, `spend` and `flagged`/`clear` now come from one `fuel_range_totals` call with
 * no page to be capped. Fleet MPG and total miles deliberately do NOT: both carry judgement (the MPG
 * plausibility band; `robustWindowMiles` returning null rather than 0 for a non-advancing window), and
 * D-AG1's ruling is that judgement stays where a unit test can reach it. A future change that "finishes
 * the job" by moving those into SQL is the regression this file is here to make loud.
 */

interface Call { method: string; args: unknown[] }
const calls: Call[] = [];
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

/** Rows the paging loop sees. One truck, two fills, 100 miles apart at 10 mpg. */
const LOOP_ROWS = [
  { vehicle_id: "v1", odometer: 1000, samsara_odometer: 1000, samsara_odometer_source: "obd", gallons: 10, computed_mpg: 6 },
  { vehicle_id: "v1", odometer: 1100, samsara_odometer: 1100, samsara_odometer_source: "obd", gallons: 10, computed_mpg: 8 },
];

function recorder(): unknown {
  const target = {
    then(resolve: (v: unknown) => void) {
      resolve({ data: LOOP_ROWS, error: null, count: LOOP_ROWS.length });
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

// Figures nothing in the loop rows could produce, so a tile carrying them can only have come from here.
const RPC_ROW = { fills: 4321, gallons: 98_765, spend: 456_789, has_cost: true, flagged: 77, clear: 4244 };
let rpcError: { message: string } | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => { calls.push({ method: "from", args: [table] }); return recorder(); },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcError ? { data: null, error: rpcError } : { data: [RPC_ROW], error: null };
    },
  },
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ orgId: "org-1" }) }));

import { useFuelRangeTotals, type FuelFilters } from "./useFuelLog";

async function totals(filters: FuelFilters = {}) {
  let out: unknown;
  const Host = defineComponent({
    setup() {
      const q = useFuelRangeTotals(ref(filters));
      return () => { out = q.data.value; return null; };
    },
  });
  mount(Host, { global: { plugins: [VueQueryPlugin] } });
  await flushPromises();
  await flushPromises();
  await flushPromises();
  return out as Record<string, unknown> | undefined;
}

beforeEach(() => { calls.length = 0; rpcCalls.length = 0; rpcError = null; });

describe("useFuelRangeTotals — four tiles that cannot be capped, two that still can", () => {
  it("takes fills, gallons, spend, flagged and clear from the RPC, not from the paged rows", async () => {
    const t = await totals({ from: "2026-08-01", to: "2026-08-31" });
    // The loop returned two fills totalling 20 gallons. Every figure below is the RPC's.
    expect(t).toMatchObject({
      fillUps: 4321,
      totalGallons: 98_765,
      totalCost: 456_789,
      hasCost: true,
      flagged: 77,
      clear: 4244,
    });
  });

  it("still derives miles and fleet MPG in TypeScript, from the rows — D-AG1", async () => {
    const t = await totals({});
    // 1000 → 1100 on the OBD span. If this ever starts coming from the RPC it will not be 100.
    expect(t!.totalMiles).toBe(100);
    // Gallon-weighted mean of 6 and 8 over equal gallons.
    expect(t!.fleetMpg).toBe(7);
  });

  it("asks the database for exactly one thing, and it is the totals function", async () => {
    await totals({});
    expect(rpcCalls.map((c) => c.fn)).toEqual(["fuel_range_totals"]);
  });

  it("passes every filter the list uses, so the tiles and the rows describe one set", async () => {
    await totals({
      from: "2026-08-01", to: "2026-08-31",
      vehicleId: "veh-1", driverId: "drv-1", tankType: "reefer",
      search: "Pilot", searchVehicleIds: ["veh-9"], searchDriverIds: ["drv-9"],
    });
    expect(rpcCalls[0]!.args).toEqual({
      p_from: "2026-08-01",
      p_to: "2026-08-31",
      p_vehicle: "veh-1",
      p_driver: "drv-1",
      p_tank_type: "reefer",
      p_search: "Pilot",
      p_search_vehicles: ["veh-9"],
      p_search_drivers: ["drv-9"],
    });
  });

  // The tiles and the list must filter on the SAME string. The list strips `%,()` for PostgREST's
  // `.or()` grammar; if the RPC were handed the raw term instead, a search containing any of those
  // characters would count a different set than the rows beneath it — which is the disagreement
  // FUEL-T3a exists to end.
  it("sanitises the search term the same way the list does", async () => {
    await totals({ search: "  Pi%lot,(TX)  " });
    expect(rpcCalls[0]!.args.p_search).toBe("PilotTX");
  });

  it("sends null rather than an empty term when nothing is searched", async () => {
    await totals({ search: "%%%" });
    expect(rpcCalls[0]!.args.p_search).toBeNull();
    expect(rpcCalls[0]!.args.p_search_vehicles).toBeNull();
  });

  it("surfaces an RPC failure instead of rendering zeros", async () => {
    // A swallowed error here reads as "no fuel this month" — a confident, wrong, alarming number.
    rpcError = { message: "function fuel_range_totals does not exist" };
    const t = await totals({});
    expect(t).toBeUndefined();
  });
});
