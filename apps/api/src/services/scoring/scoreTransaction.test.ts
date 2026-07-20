import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { scoreTransaction } from "./scoreTransaction.js";

/**
 * Characterization tests for scoreTransaction — the previously-untested core scoring pass.
 * A flexible fake Supabase admin routes each select() chain to canned rows (by table + eq filters) and
 * captures every write for assertions. Uses the skipRecon rebuild path (no live Samsara) + skipLearn.
 */
interface Write { table: string; op: "insert" | "update" | "delete"; payload?: Record<string, unknown> }
type SelectState = { table: string; select: string; eq: Record<string, unknown> };

function makeAdmin(resolve: (q: SelectState) => unknown[]) {
  const writes: Write[] = [];
  function selectBuilder(table: string, select: string) {
    const eq: Record<string, unknown> = {};
    const state: SelectState = { table, select, eq };
    const b = {
      eq: (k: string, v: unknown) => { eq[k] = v; return b; },
      neq: () => b, lt: () => b, lte: () => b, gte: () => b, gt: () => b,
      not: () => b, in: () => b, order: () => b, limit: () => b,
      single: async () => ({ data: resolve(state)[0] ?? null }),
      maybeSingle: async () => ({ data: resolve(state)[0] ?? null }),
      then: (r: (v: { data: unknown }) => unknown) => Promise.resolve({ data: resolve(state) }).then(r),
    };
    return b;
  }
  function writeBuilder(table: string, op: Write["op"], payload?: Record<string, unknown>) {
    writes.push({ table, op, payload });
    const b = {
      eq: () => b, in: () => b, neq: () => b,
      then: (r: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(r),
    };
    return b;
  }
  const admin = {
    from: (table: string) => ({
      select: (select = "") => selectBuilder(table, select),
      insert: (payload: Record<string, unknown>) => writeBuilder(table, "insert", payload),
      update: (payload: Record<string, unknown>) => writeBuilder(table, "update", payload),
      delete: () => writeBuilder(table, "delete"),
    }),
  } as unknown as SupabaseClient;
  return { admin, writes };
}

const env = {} as unknown as Env;

const txnRow = {
  id: "t1", org_id: "org1", vehicle_id: "v1", driver_id: null,
  fueled_at: "2026-06-15T14:00:00.000Z", fueled_at_precision: "instant",
  odometer: 100000, gallons: 100, price_per_gal: 4, total_cost: 400, version: 1,
  source: "efs", card_ref: null, city: "Dallas", state: "TX", location_text: "Pilot Dallas",
  tank_type: "tractor",
  samsara_odometer: null, samsara_odometer_at: null, samsara_odometer_source: null,
  samsara_location_matched: null, samsara_location_confidence: null, samsara_nearest_station_miles: null,
  station_lat: null, station_lng: null, samsara_tank_short_gal: null, samsara_tank_observed_gal: null,
  samsara_fuel_pct_before: null, samsara_fuel_pct_after: null,
  samsara_observed_state: null, samsara_observed_city: null, samsara_observed_address: null,
  samsara_observed_lat: null, samsara_observed_lng: null, fueling_time_basis: null, samsara_recon_at: null,
};
const vehicleRow = {
  id: "v1", fuel_type: "diesel", tank_capacity_gal: 150, tank_sensor_reliable: false,
  observed_max_fill_gal: null, baseline_mpg: 6.5, samsara_vehicle_id: null,
  odometer_offset: 0, odometer_offset_source: "auto",
};

describe("scoreTransaction — characterization (skipRecon rebuild path)", () => {
  it("scores a clean tractor fill: updates the transaction, writes no anomaly", async () => {
    const { admin, writes } = makeAdmin((q) => {
      if (q.table === "fuel_transactions" && q.eq.id === "t1") return [txnRow];
      if (q.table === "vehicles" && q.eq.id === "v1") return [vehicleRow];
      return [];
    });
    await scoreTransaction(admin, env, "org1", "t1", { skipRecon: true, skipLearn: true });

    const ftxn = writes.find((w) => w.table === "fuel_transactions" && w.op === "update");
    expect(ftxn, "fuel_transactions should be updated").toBeTruthy();
    expect(ftxn!.payload!.has_anomaly).toBe(false);
    expect(writes.filter((w) => w.table === "anomalies" && w.op === "insert")).toHaveLength(0);
  });

  it("returns early (no writes) when the transaction row is missing", async () => {
    const { admin, writes } = makeAdmin(() => []);
    await scoreTransaction(admin, env, "org1", "missing", { skipRecon: true, skipLearn: true });
    expect(writes).toHaveLength(0);
  });
});
