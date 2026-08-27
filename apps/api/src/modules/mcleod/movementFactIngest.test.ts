import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ingestMovementFacts } from "./movementFactIngest.js";
import { tmsMovementFactsPayloadSchema, tmsMovementFactSchema } from "@silvicom/shared";

const ORG = "11111111-1111-1111-1111-111111111111";

const stop = (over: Record<string, unknown> = {}) => ({
  seq: 1,
  kind: "pickup",
  city: "Chicago",
  state: "IL",
  lat: 41.88,
  lon: -87.63,
  arrived_at: "2026-06-14T08:00:00Z",
  departed_at: "2026-06-14T09:30:00Z",
  ...over,
});

const movement = (over: Record<string, unknown> = {}) => ({
  external_id: "M-1",
  company_id: "TMS",
  tractor_unit: "754",
  trailer_unit: "T-88",
  driver_external_ids: ["D42"],
  order_ids: ["O-7"],
  loaded_miles: 812.4,
  fuel_miles: 815.1,
  settled_at: "2026-06-16T00:00:00Z",
  stops: [stop(), stop({ seq: 2, kind: "dropoff", city: "Atlanta", state: "GA", lat: 33.75, lon: -84.39, distance_from_previous: 812.4 })],
  ...over,
});

describe("ingestMovementFacts", () => {
  it("upserts full rows onto (org_id, external_id) — every row names the org", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_movements: [{ id: "x" }] } });
    const payload = tmsMovementFactsPayloadSchema.parse({
      // The second movement is team-driven: two driver ids must land as one row's array, never as
      // a second row — a duplicated movement double-counts its miles into cents-per-mile.
      movements: [movement(), movement({ external_id: "M-2", driver_external_ids: ["D42", "D77"] })],
      window_start: "2026-06-01",
      window_end: "2026-07-01",
    });
    const r = await ingestMovementFacts(rec.client, ORG, payload);
    expect(r.received).toBe(2);
    const rows = rec.writtenRows("mcleod_movements");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      org_id: ORG,
      external_id: "M-1",
      tractor_unit: "754",
      loaded_miles: 812.4,
      fuel_miles: 815.1,
      distance_unit: "MI",
      driver_external_ids: ["D42"],
      order_ids: ["O-7"],
    });
    expect(rows[1]).toMatchObject({ external_id: "M-2", driver_external_ids: ["D42", "D77"] });
    expect(Object.keys(rows[0]!).sort()).toEqual(Object.keys(rows[1]!).sort());
    expectOrgScoped(rec, ORG);
  });

  it("stores stops as the contract's own ordered array, so a read-back re-validates unchanged", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_movements: [{ id: "x" }] } });
    const payload = tmsMovementFactsPayloadSchema.parse({
      movements: [movement()],
      window_start: "2026-06-01",
      window_end: "2026-07-01",
    });
    await ingestMovementFacts(rec.client, ORG, payload);
    const stored = rec.writtenRows("mcleod_movements")[0]!;
    // The JSONB column holds tmsStopFactSchema's shape verbatim — proven by re-parsing the stored
    // row through the movement contract, which is exactly what the CPM harness's deadhead chain
    // (`inferDeadheadLegs`) will do when it reads staging back.
    const reparsed = tmsMovementFactSchema.parse({
      external_id: stored.external_id,
      company_id: "TMS",
      tractor_unit: stored.tractor_unit,
      driver_external_ids: stored.driver_external_ids,
      order_ids: stored.order_ids,
      loaded_miles: stored.loaded_miles,
      stops: stored.stops,
    });
    expect(reparsed.stops).toHaveLength(2);
    expect(reparsed.stops[1]).toMatchObject({ kind: "dropoff", lat: 33.75, lon: -84.39 });
  });
});
