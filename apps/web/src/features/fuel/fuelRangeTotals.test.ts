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

/** Per-vehicle measurements, as `fuel_range_miles_inputs` returns them (migration 0290, FUEL-T3b). */
interface MilesRow {
  vehicle_id: string | null;
  obd_count: number; obd_min: number | null; obd_max: number | null;
  entered_count: number; entered_min: number | null; entered_max: number | null;
  entered_worst_step: number | null;
  mpg_weighted: number; mpg_gallons: number;
}
const MILES_ROWS: MilesRow[] = [
  // A truck with a clean 100-mile OBD span, and MPG sums already banded by the database.
  { vehicle_id: "v1", obd_count: 2, obd_min: 1000, obd_max: 1100, entered_count: 2, entered_min: 1000, entered_max: 1100, entered_worst_step: 0, mpg_weighted: 140, mpg_gallons: 20 },
  // A fill attributed to NO truck: contributes to fleet MPG and to nothing else.
  { vehicle_id: null, obd_count: 0, obd_min: null, obd_max: null, entered_count: 0, entered_min: null, entered_max: null, entered_worst_step: null, mpg_weighted: 0, mpg_gallons: 0 },
];

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

let rpcRow: Record<string, unknown> = {};
// Figures nothing in the loop rows could produce, so a tile carrying them can only have come from here.
const RPC_ROW = { fills: 4321, gallons: 98_765, spend: 456_789, has_cost: true, flagged: 77, clear: 4244, fills_with_vehicle: 4001 };
let rpcError: { message: string } | null = null;
let milesError: { message: string } | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => { calls.push({ method: "from", args: [table] }); return recorder(); },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (rpcError) return { data: null, error: rpcError };
      if (fn === "fuel_range_miles_inputs" && milesError) return { data: null, error: milesError };
      return { data: fn === "fuel_range_totals" ? [rpcRow] : MILES_ROWS, error: null };
    },
  },
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ orgId: "org-1" }) }));

import { MPG_PLAUSIBLE_MIN, MPG_PLAUSIBLE_MAX } from "@silvicom/shared";
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

beforeEach(() => { calls.length = 0; rpcCalls.length = 0; rpcError = null; milesError = null; rpcRow = { ...RPC_ROW }; });

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
      fillsWithVehicle: 4001,
    });
  });

  // ⚠ FUEL-T5 / migration 0297. `fills_with_vehicle` is the one field here whose ABSENCE and whose
  // ZERO mean opposite things. Zero is "not one fill in this window names a truck" — alarming for a
  // fleet, and a lie for a deploy window. `lint:migration-ordering` reads columns and cannot see a
  // function's return shape, so nothing mechanical stops a reader reaching production in the nine
  // minutes before its schema does; this is what makes that window silent instead of confident.
  it("reports NULL, never 0, when the function has not got its 0297 column yet", async () => {
    delete (rpcRow as { fills_with_vehicle?: number }).fills_with_vehicle;
    expect((await totals({}))!.fillsWithVehicle).toBeNull();

    rpcRow = { ...RPC_ROW, fills_with_vehicle: null };
    expect((await totals({}))!.fillsWithVehicle).toBeNull();
  });

  it("passes a genuine zero through as zero — an org whose fills name no truck is a real answer", async () => {
    rpcRow = { ...RPC_ROW, fills_with_vehicle: 0 };
    expect((await totals({}))!.fillsWithVehicle).toBe(0);
  });

  it("still applies the miles JUDGEMENT in TypeScript — D-AG1", async () => {
    const t = await totals({});
    // The database returned a span (1000→1100). TypeScript decided that the span is real; the verdict
    // did not come from SQL.
    expect(t!.totalMiles).toBe(100);
  });

  // ⚠ THERE IS NO `fleetMpg` HERE ANY MORE, and this is the note that stops it coming back (M4,
  // D-MPG1). It was `Σ(mpg_weighted) ÷ Σ(mpg_gallons)` over this same RPC — one of four copies of a
  // definition whose numerator ran 1.31–2.41% below Samsara's own IFTA miles, because
  // `computed_mpg` divides by `gallons + intermediateGallons` while the weighting used `gallons`.
  // The Fills tab reads `GET /api/fueling/fleet-mpg`, whose miles are two odometer readings the
  // vendor asserted. `fuel_range_miles_inputs` still RETURNS those two columns — an applied
  // migration cannot be edited — and nothing reads them.

  // ⚠ NOT ASSERTED HERE, and the reason is worth stating rather than leaving as a gap. A non-advancing
  // span makes `robustWindowMiles` return null rather than 0 — the guard its header calls the most
  // important one it makes — but this composable SUMS, and `null ?? 0` and `0` both contribute nothing.
  // The suppression is therefore **unobservable at the fleet total**: it matters to the over-fuel
  // ceiling, where a 0-mile window makes `burnable` 0 and every purchase clears it. A test here would
  // pass whether the guard existed or not, which is not a test. `windowMilesAggregate.test.ts` pins it
  // where it is falsifiable, against `robustWindowMiles` itself.

  it("refuses the entered span when it steps back further than the tolerance", async () => {
    MILES_ROWS[0] = { ...MILES_ROWS[0]!, obd_count: 0, obd_min: null, obd_max: null, entered_worst_step: -100 };
    expect((await totals({}))!.totalMiles).toBe(0);
    // …and accepts it when the step is inside the tolerance, so it is the STEP that decided.
    MILES_ROWS[0] = { ...MILES_ROWS[0]!, entered_worst_step: -0.5 };
    expect((await totals({}))!.totalMiles).toBe(100);
    MILES_ROWS[0] = { ...MILES_ROWS[0]!, obd_count: 2, obd_min: 1000, obd_max: 1100, entered_worst_step: 0 };
  });

  it("adds no distance for a fill attributed to no truck", async () => {
    // An unattributed fill has no odometer span, so it can contribute nothing to the miles tile. Its
    // GALLONS still count in `fuel_range_totals` — the money and the fuel were real — which is what
    // the `fillsWithVehicle` coverage line beneath the tiles exists to explain.
    MILES_ROWS[1] = { ...MILES_ROWS[1]!, mpg_weighted: 60, mpg_gallons: 10 };
    expect((await totals({}))!.totalMiles).toBe(100);
    MILES_ROWS[1] = { ...MILES_ROWS[1]!, mpg_weighted: 0, mpg_gallons: 0 };
  });

  it("asks the database for both functions, and never pages fuel_transactions itself", async () => {
    await totals({});
    expect(rpcCalls.map((c) => c.fn).sort()).toEqual(["fuel_range_miles_inputs", "fuel_range_totals"]);
    // The loop that made every tile depend on `max_rows` is gone; nothing here reads the table directly.
    expect(calls.filter((c) => c.method === "from")).toEqual([]);
  });

  it("sends the plausibility band as an argument, so SQL never holds a copy of it", async () => {
    await totals({});
    const miles = rpcCalls.find((c) => c.fn === "fuel_range_miles_inputs")!;
    expect(miles.args).toMatchObject({ p_mpg_min: MPG_PLAUSIBLE_MIN, p_mpg_max: MPG_PLAUSIBLE_MAX });
  });

  it("passes every filter the list uses, so the tiles and the rows describe one set", async () => {
    await totals({
      from: "2026-08-01", to: "2026-08-31",
      vehicleIds: ["veh-1", "veh-2"], driverId: "drv-1", tankType: "reefer",
      search: "Pilot", searchVehicleIds: ["veh-9"], searchDriverIds: ["drv-9"],
    });
    expect(rpcCalls.find((c) => c.fn === "fuel_range_totals")!.args).toEqual({
      p_from: "2026-08-01",
      p_to: "2026-08-31",
      p_vehicles: ["veh-1", "veh-2"],
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
    // BOTH functions must receive it, or the two halves of one tile row describe different sets.
    for (const c of rpcCalls) expect(c.args.p_search).toBe("PilotTX");
  });

  it("sends null rather than an empty term when nothing is searched", async () => {
    await totals({ search: "%%%" });
    for (const c of rpcCalls) {
      expect(c.args.p_search).toBeNull();
      expect(c.args.p_search_vehicles).toBeNull();
    }
  });

  it("surfaces an RPC failure instead of rendering zeros", async () => {
    // A swallowed error here reads as "no fuel this month" — a confident, wrong, alarming number.
    rpcError = { message: "function fuel_range_totals does not exist" };
    const t = await totals({});
    expect(t).toBeUndefined();
  });

  // The two calls fail independently, and the second one needs its own case: `fuel_range_totals` runs
  // first, so a shared error fixture never reaches the miles call at all and a swallowed error there
  // would go unnoticed.
  it("surfaces a failure of the MILES call too, not just the totals one", async () => {
    milesError = { message: "function fuel_range_miles_inputs does not exist" };
    expect(await totals({})).toBeUndefined();
  });
});
