import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreTransaction } from "./scoreTransaction.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * Characterization tests for scoreTransaction — the previously-untested core scoring pass.
 * A flexible fake Supabase admin routes each select() chain to canned rows (by table + eq filters) and
 * captures every write for assertions. Uses the skipRecon rebuild path (no live Samsara) + skipLearn.
 */
interface Write {
  table: string;
  op: "insert" | "update" | "delete";
  payload?: Record<string, unknown>;
}
type SelectState = { table: string; select: string; eq: Record<string, unknown> };
type RpcCall = { fn: string; args: Record<string, unknown> };

function makeAdmin(resolve: (q: SelectState) => unknown[]) {
  const writes: Write[] = [];
  const rpcCalls: RpcCall[] = [];
  function selectBuilder(table: string, select: string) {
    const eq: Record<string, unknown> = {};
    const state: SelectState = { table, select, eq };
    const b = {
      eq: (k: string, v: unknown) => {
        eq[k] = v;
        return b;
      },
      neq: () => b,
      lt: () => b,
      lte: () => b,
      gte: () => b,
      gt: () => b,
      not: () => b,
      in: () => b,
      or: () => b,
      order: () => b,
      limit: () => b,
      single: async () => ({ data: resolve(state)[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: resolve(state)[0] ?? null, error: null }),
      then: (r: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: resolve(state), error: null }).then(r),
    };
    return b;
  }
  function writeBuilder(table: string, op: Write["op"], payload?: Record<string, unknown>) {
    writes.push({ table, op, payload });
    const b = {
      select: () => ({
        single: async () => ({ data: { id: payload?.id ?? "attempt-1" }, error: null }),
        maybeSingle: async () => ({ data: { id: payload?.id ?? "attempt-1" }, error: null }),
      }),
      eq: () => b,
      in: () => b,
      neq: () => b,
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
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: { idempotent: false, anomaly_id: args.p_case ? "a1" : null }, error: null };
    },
  } as unknown as SupabaseClient;
  return { admin, writes, rpcCalls };
}

const env = testEnv();

const txnRow = {
  id: "t1",
  org_id: "org1",
  vehicle_id: "v1",
  driver_id: null,
  fueled_at: "2026-06-15T14:00:00.000Z",
  fueled_at_precision: "instant",
  odometer: 100000,
  gallons: 100,
  price_per_gal: 4,
  total_cost: 400,
  version: 1,
  source: "efs",
  card_ref: null,
  city: "Dallas",
  state: "TX",
  location_text: "Pilot Dallas",
  tank_type: "tractor",
  samsara_odometer: null,
  samsara_odometer_at: null,
  samsara_odometer_source: null,
  samsara_location_matched: null,
  samsara_location_confidence: null,
  samsara_nearest_station_miles: null,
  station_lat: null,
  station_lng: null,
  samsara_tank_short_gal: null,
  samsara_tank_observed_gal: null,
  samsara_fuel_pct_before: null,
  samsara_fuel_pct_after: null,
  samsara_observed_state: null,
  samsara_observed_city: null,
  samsara_observed_address: null,
  samsara_observed_lat: null,
  samsara_observed_lng: null,
  fueling_time_basis: null,
  samsara_recon_at: null,
};
const vehicleRow = {
  id: "v1",
  fuel_type: "diesel",
  tank_capacity_gal: 150,
  tank_sensor_reliable: false,
  observed_max_fill_gal: null,
  baseline_mpg: 6.5,
  samsara_vehicle_id: null,
  odometer_offset: 0,
  odometer_offset_source: "auto",
};

/**
 * A fill whose tank rose 50 gal less than the 100 billed, on a truck whose sensor is learned reliable:
 * `tank_fill_short`, the one approved-fill rule that still raises a case (a Review) since CF5. Before
 * CF5 these tests used a 300 gal overfill, which is now a note and raises nothing.
 */
const shortFill = { ...txnRow, samsara_tank_short_gal: 50, samsara_tank_observed_gal: 50, samsara_recon_at: "2026-06-15T15:00:00.000Z" };
const reliableVehicle = { ...vehicleRow, tank_sensor_reliable: true };

/** The existing-anomalies read is the only anomalies select that carries "source" in its column list. */

describe("scoreTransaction — characterization (skipRecon rebuild path)", () => {
  it("scores a clean tractor fill through the atomic persistence RPC", async () => {
    const { admin, rpcCalls } = makeAdmin((q) => {
      if (q.table === "fuel_transactions" && q.eq.id === "t1") return [txnRow];
      if (q.table === "vehicles" && q.eq.id === "v1") return [vehicleRow];
      return [];
    });
    await scoreTransaction(admin, env, "org1", "t1", { skipRecon: true, skipLearn: true });

    const rpc = rpcCalls.find((c) => c.fn === "persist_scoring_outcome_v2");
    expect(rpc).toBeTruthy();
    expect(rpc!.args.p_case).toBeNull();
    expect((rpc!.args.p_outcome as Record<string, unknown>).has_anomaly).toBe(false);
  });

  it("returns early (no writes) when the transaction row is missing", async () => {
    const { admin, writes } = makeAdmin(() => []);
    await scoreTransaction(admin, env, "org1", "missing", { skipRecon: true, skipLearn: true });
    expect(writes).toHaveLength(0);
  });

  it("CF5: a fill over the tank's capacity is a note — no case, not flagged, the rule kept on the fill", async () => {
    // 300 gal into a 150 gal tank (limit 157.5 at the 5% default tolerance) → exceeds_tank_capacity, which
    // was an alert on its own until CF5. No other rule can fire: the window/prev queries return no rows.
    const overfill = { ...txnRow, gallons: 300 };
    const { admin, rpcCalls } = makeAdmin((q) => {
      if (q.table === "fuel_transactions" && q.eq.id === "t1") return [overfill];
      if (q.table === "vehicles" && q.eq.id === "v1") return [vehicleRow];
      return [];
    });
    await scoreTransaction(admin, env, "org1", "t1", { skipRecon: true, skipLearn: true });

    const rpc = rpcCalls.find((c) => c.fn === "persist_scoring_outcome_v2");
    expect(rpc).toBeTruthy();
    expect(rpc!.args.p_case).toBeNull();
    const outcome = rpc!.args.p_outcome as Record<string, unknown>;
    expect(outcome.has_anomaly).toBe(false);
    expect(outcome.case_level).toBe("clear");
    expect((outcome.case_signals_unscored as { ruleId: string }[]).map((x) => x.ruleId)).toContain("exceeds_tank_capacity");
  });

  it("a tank that rose less than billed raises a review case and flags the fill (medium: no email, no bell)", async () => {
    const { admin, rpcCalls } = makeAdmin((q) => {
      if (q.table === "fuel_transactions" && q.eq.id === "t1") return [shortFill];
      if (q.table === "vehicles" && q.eq.id === "v1") return [reliableVehicle];
      return [];
    });
    await scoreTransaction(admin, env, "org1", "t1", { skipRecon: true, skipLearn: true });

    const rpc = rpcCalls.find((c) => c.fn === "persist_scoring_outcome_v2");
    expect(rpc).toBeTruthy();
    expect((rpc!.args.p_case as Record<string, unknown>).rule_id).toBe("theft_case");
    expect((rpc!.args.p_case as Record<string, unknown>).severity).toBe("medium");
    expect((rpc!.args.p_outcome as Record<string, unknown>).has_anomaly).toBe(true);
    expect((rpc!.args.p_outcome as Record<string, unknown>).case_level).toBe("review");
    expect((rpc!.args.p_outcome as Record<string, unknown>).max_severity).toBe("medium");
  });

  it("sends a clean outcome to the atomic RPC so stale cases can be superseded in the database transaction", async () => {
    const { admin, rpcCalls } = makeAdmin((q) => {
      if (q.table === "fuel_transactions" && q.eq.id === "t1") return [txnRow];
      if (q.table === "vehicles" && q.eq.id === "v1") return [vehicleRow];
      return [];
    });
    await scoreTransaction(admin, env, "org1", "t1", { skipRecon: true, skipLearn: true });

    const rpc = rpcCalls.find((c) => c.fn === "persist_scoring_outcome_v2");
    expect(rpc).toBeTruthy();
    expect(rpc!.args.p_case).toBeNull();
    expect((rpc!.args.p_outcome as Record<string, unknown>).case_level).toBe("clear");
  });

  it("sends a re-fired case to the atomic RPC with an idempotency identity", async () => {
    const { admin, rpcCalls } = makeAdmin((q) => {
      if (q.table === "fuel_transactions" && q.eq.id === "t1") return [shortFill];
      if (q.table === "vehicles" && q.eq.id === "v1") return [reliableVehicle];
      return [];
    });
    await scoreTransaction(admin, env, "org1", "t1", { skipRecon: true, skipLearn: true });

    const rpc = rpcCalls.find((c) => c.fn === "persist_scoring_outcome_v2");
    expect(rpc).toBeTruthy();
    expect((rpc!.args.p_case as Record<string, unknown>).rule_id).toBe("theft_case");
    expect(rpc!.args.p_attempt_id).toBeTruthy();
    expect(rpc!.args.p_result_hash).toMatch(/^sha256:/);
  });

  // CF2 (chunk 5c): once the score is stored, an approved fill Samsara placed away from its station goes
  // to the card fraud hook. The hook's own behaviour is ../cardFraudFill.test.ts; this pins the wiring.
  // This fake answers every RPC with the scoring shape, so the incident write fails and is logged.
  const awayFill = { ...txnRow, card_ref: "7083050000000367559", samsara_location_matched: false as boolean | null, samsara_location_confidence: "mismatch" };
  const fraudWrites = (row: typeof awayFill) => async () => {
    const { admin, rpcCalls } = makeAdmin((q) => {
      if (q.table === "fuel_transactions" && q.eq.id === "t1") return [row];
      if (q.table === "vehicles" && q.eq.id === "v1") return [vehicleRow];
      return [];
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await scoreTransaction(admin, env, "org1", "t1", { skipRecon: true, skipLearn: true });
    warn.mockRestore();
    expect(rpcCalls.some((c) => c.fn === "persist_scoring_outcome_v2")).toBe(true);
    return rpcCalls.filter((c) => c.fn === "card_fraud_record");
  };

  it("an approved fill Samsara placed away from the station is recorded as a card fraud attempt", async () => {
    const calls = await fraudWrites(awayFill)();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toMatchObject({ p_org: "org1", p_attempt_source: "fill", p_attempt_id: "t1", p_fuel_taken: true });
  });

  it("a fill Samsara placed at the station is not", async () => {
    expect(await fraudWrites({ ...awayFill, samsara_location_matched: true })()).toHaveLength(0);
  });

  // D-CF9 (0439): a fill before the org's detection start date raises no case and is not flagged; the
  // engine's measured verdict is still stored. Without this the boot rebuild re-opens every case the
  // reset closed (0158: a closed case does not block a new one).
  const shortFillAdmin = (epoch: string | null) =>
    makeAdmin((q) => {
      if (q.table === "fuel_transactions" && q.eq.id === "t1") return [shortFill];
      if (q.table === "vehicles" && q.eq.id === "v1") return [reliableVehicle];
      if (q.table === "organizations" && q.eq.id === "org1" && q.select.includes("detection_epoch")) return [{ detection_epoch: epoch }];
      return [];
    });
  const persisted = (rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>) =>
    rpcCalls.find((c) => c.fn === "persist_scoring_outcome_v2")!.args;

  it("a fill before the detection start date raises no case and is not flagged, but keeps its measured verdict", async () => {
    const { admin, rpcCalls } = shortFillAdmin("2026-06-15T14:00:00.001Z"); // the fill is 1 ms before
    await scoreTransaction(admin, env, "org1", "t1", { skipRecon: true, skipLearn: true });
    const args = persisted(rpcCalls);
    expect(args.p_case).toBeNull();
    const outcome = args.p_outcome as Record<string, unknown>;
    expect(outcome.has_anomaly).toBe(false);
    expect(outcome.max_severity).toBeNull();
    expect(outcome.case_level).toBe("review");
  });

  it("a fill at the start date, or an org never reset, raises its case as before", async () => {
    for (const epoch of ["2026-06-15T14:00:00.000Z", null]) {
      const { admin, rpcCalls } = shortFillAdmin(epoch);
      await scoreTransaction(admin, env, "org1", "t1", { skipRecon: true, skipLearn: true });
      expect((persisted(rpcCalls).p_case as Record<string, unknown>).rule_id).toBe("theft_case");
      expect((persisted(rpcCalls).p_outcome as Record<string, unknown>).has_anomaly).toBe(true);
    }
  });

  it("a bulk run's hoisted start date is used instead of a read per fill", async () => {
    const { admin, rpcCalls } = shortFillAdmin(null);
    await scoreTransaction(admin, env, "org1", "t1", {
      skipRecon: true, skipLearn: true, ctx: { detectionEpoch: "2026-10-08T12:00:00Z" },
    });
    expect(persisted(rpcCalls).p_case).toBeNull();
  });
});
