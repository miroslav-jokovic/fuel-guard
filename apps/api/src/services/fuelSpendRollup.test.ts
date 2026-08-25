import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { buildFuelSpendRollup } from "./fuelSpendRollup.js";

/**
 * Persisting the daily fuel-spend rollup (migration 0244).
 *
 * The derivation itself is pure and tested in `packages/shared/src/fuelSpend/rollupDerive.test.ts`.
 * What is only testable here is everything AROUND it, and each of these has a way of going wrong that
 * produces a plausible number rather than an error:
 *
 *   • the tenant filter, because the service role bypasses RLS and the filter IS the boundary;
 *   • the lookback, because without extra history the first day of every window has no previous fill
 *     and silently loses its odometer interval;
 *   • the write shape, because `lint:upserts` exists to stop a partial payload conflicting on a key;
 *   • the stale sweep, because it deletes, and a sweep with the wrong bound deletes live rows.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const fill = (o: Record<string, unknown> = {}) => ({
  vehicle_id: "v1",
  fueled_at: "2026-08-18T14:00:00Z",
  state: "TX",
  tank_type: "tractor",
  gallons: 120,
  total_cost: 620.4,
  miles_since_last: null,
  ...o,
});

function seed(over: Record<string, unknown> = {}): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      fuel_transactions: [fill()],
      vehicles: [{ id: "v1", unit_number: "754" }],
      efs_transactions: [],
      vehicle_engine_days: [],
      fuel_spend_days: [],
      ...over,
    },
  });
}

describe("buildFuelSpendRollup", () => {
  it("scopes every query to one organization", async () => {
    const rec = seed();
    await buildFuelSpendRollup(rec.client, ORG, "2026-08-17", "2026-08-23");
    // No exemptions: every table this service touches is tenant data, including the vehicles it reads
    // only to resolve DEF unit numbers.
    expectOrgScoped(rec, ORG);
  });

  it("reads three weeks of extra history, so the first day still has a previous fill to measure from", async () => {
    const rec = seed();
    await buildFuelSpendRollup(rec.client, ORG, "2026-08-17", "2026-08-23");
    const read = rec.forTable("fuel_transactions").find((q) => !q.write)!;
    const gte = read.ops.find((o) => o.method === "gte")?.args[1] as string;
    // Window opens 2026-08-17; with a 21-day lookback and a day of station-local slack, 2026-07-26.
    expect(gte.slice(0, 10)).toBe("2026-07-26");
  });

  it("widens the fill window a day past the end, because business dates are station-local", async () => {
    const rec = seed();
    await buildFuelSpendRollup(rec.client, ORG, "2026-08-17", "2026-08-23");
    const read = rec.forTable("fuel_transactions").find((q) => !q.write)!;
    expect((read.ops.find((o) => o.method === "lte")?.args[1] as string).slice(0, 10)).toBe("2026-08-24");
  });

  it("writes the whole row and conflicts on the natural key, never on the primary key", async () => {
    const rec = seed();
    await buildFuelSpendRollup(rec.client, ORG, "2026-08-17", "2026-08-23");
    const write = rec.forTable("fuel_spend_days").find((q) => q.write?.method === "upsert")!;
    expect((write.ops.find((o) => o.method === "upsert")?.args[1] as { onConflict: string }).onConflict).toBe(
      "org_id,vehicle_id,day",
    );
    const row = rec.writtenRows("fuel_spend_days")[0]!;
    // Every NOT NULL column in 0244 is present: Postgres checks them before conflict arbitration.
    for (const col of [
      "org_id", "vehicle_id", "day", "fills", "gallons_tractor", "gallons_reefer", "gallons_def",
      "spend_tractor", "spend_reefer", "spend_def", "miles", "mpg_gallons", "miles_basis",
      "miles_rejected", "drive_sec", "idle_sec", "off_sec", "coverage_sec",
    ]) {
      expect(row).toHaveProperty(col);
    }
    expect(row.org_id).toBe(ORG);
  });

  it("sweeps only rows this run did not touch, inside the window it was asked for", async () => {
    const rec = seed();
    await buildFuelSpendRollup(rec.client, ORG, "2026-08-17", "2026-08-23");
    const del = rec.forTable("fuel_spend_days").find((q) => q.write?.method === "delete")!;
    const filters = del.ops.map((o) => `${o.method}:${String(o.args[0])}`);
    expect(filters).toContain("eq:org_id");
    expect(filters).toContain("gte:day");
    expect(filters).toContain("lte:day");
    // The bound that makes this safe: without it, the delete removes the rows just written.
    expect(filters).toContain("lt:updated_at");
  });

  it("resolves DEF to a truck by unit number and keeps the ones that miss", async () => {
    const rec = seed({
      efs_transactions: [
        { unit: "754", tran_date: "2026-08-18", qty: 9.5, amt: 34.2 },
        { unit: "999", tran_date: "2026-08-18", qty: 2.0, amt: 7.5 },
      ],
    });
    const r = await buildFuelSpendRollup(rec.client, ORG, "2026-08-17", "2026-08-23");
    expect(r.defUnmatched).toBe(1);
    const rows = rec.writtenRows("fuel_spend_days");
    expect(rows.find((x) => x.vehicle_id === "v1")?.spend_def).toBe(34.2);
    // The unmatched line is still on the bill, so it is still in the rollup — on the unattributed row.
    expect(rows.find((x) => x.vehicle_id === null)?.spend_def).toBe(7.5);
  });

  it("asks the DEF feed only for DEF, not for the whole EFS ledger", async () => {
    const rec = seed();
    await buildFuelSpendRollup(rec.client, ORG, "2026-08-17", "2026-08-23");
    const read = rec.forTable("efs_transactions").find((q) => !q.write)!;
    expect(read.ops.find((o) => o.method === "in")?.args).toEqual(["item", ["DEFD", "DEF"]]);
  });

  it("reports the odometer intervals it refused rather than absorbing them", async () => {
    const rec = seed({
      fuel_transactions: [
        fill({ fueled_at: "2026-08-18T14:00:00Z" }),
        fill({ fueled_at: "2026-08-20T14:00:00Z", miles_since_last: 12406 }),
      ],
    });
    const r = await buildFuelSpendRollup(rec.client, ORG, "2026-08-17", "2026-08-23");
    expect(r.rejectedIntervals).toBe(1);
    const rows = rec.writtenRows("fuel_spend_days");
    // The fuel is still there; only its mileage was refused.
    expect(rows.reduce((a, x) => a + Number(x.gallons_tractor ?? 0), 0)).toBe(240);
    expect(rows.reduce((a, x) => a + Number(x.miles ?? 0), 0)).toBe(0);
  });

  it("counts fuel nobody's truck bought instead of dropping it from the bill", async () => {
    const rec = seed({ fuel_transactions: [fill(), fill({ vehicle_id: null, gallons: 60, total_cost: 300 })] });
    const r = await buildFuelSpendRollup(rec.client, ORG, "2026-08-17", "2026-08-23");
    expect(r.unattributedFills).toBe(1);
    expect(rec.writtenRows("fuel_spend_days").reduce((a, x) => a + Number(x.spend_tractor ?? 0), 0)).toBe(920.4);
  });

  it("surfaces a write failure rather than reporting a rebuild that did not happen", async () => {
    const rec = seed({ fuel_spend_days: { data: [], writeError: { message: "deadlock detected" } } });
    await expect(buildFuelSpendRollup(rec.client, ORG, "2026-08-17", "2026-08-23")).rejects.toThrow(/deadlock detected/);
  });
});
