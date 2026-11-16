import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { recordFleetpalMovement, getFleetpalShelf, type FleetpalMovement } from "./fleetpalShelf.js";
import { setFleetpalShelf } from "./locationsWrite.js";

/**
 * Maintenance's half of F13: the ledger door the FleetPal sweep writes through, and the switch that
 * names which place it moves. The ledger's own rules are pinned in SQL (inventory-stock.test.mjs rule
 * 13); this pins what the API makes of the ledger's answers.
 */
const ORG = "org-1";
const movement: FleetpalMovement = {
  id: "00000000-0000-5000-8000-000000000001",
  partId: "part-1",
  locationId: "loc-1",
  reason: "issued",
  quantity: 2,
  occurredAt: "2026-11-16T10:00:00Z",
  unitCost: 12.5,
  vehicleId: "truck-1",
  trailerId: null,
  workOrderRef: "WO-55",
  note: "Used on FleetPal work order WO-55.",
};

describe("recordFleetpalMovement", () => {
  it("writes through the ledger function as FleetPal's, with no person as the actor", async () => {
    const rec = createSupabaseRecorder({ rpc: { record_part_movement: { id: movement.id, part_id: "part-1", location_id: "loc-1", reason: "issued", quantity_delta: -2, source: "fleetpal" } } });
    const r = await recordFleetpalMovement(rec.client, ORG, movement);
    expect(r).toMatchObject({ outcome: "recorded", movement: { source: "fleetpal", quantityDelta: -2 } });
    const [call] = rec.rpcs();
    expect(call).toMatchObject({ fn: "record_part_movement", args: { p_org: ORG, p_actor: null, p_row: { source: "fleetpal", reason: "issued", quantity: 2 } } });
  });

  it.each([
    ["IV010", "short"],
    ["IV030", "before_start"],
    ["IV013", "part_inactive"],
  ])("answers the ledger's %s as the sweep's '%s', not as a failure", async (code, outcome) => {
    const rec = createSupabaseRecorder({ rpc: { record_part_movement: { error: { code, message: "refused" } } } });
    expect(await recordFleetpalMovement(rec.client, ORG, movement)).toEqual({ outcome });
  });

  it("treats any other refusal as an error, because then the ledger is unwell rather than the shelf", async () => {
    const rec = createSupabaseRecorder({ rpc: { record_part_movement: { error: { code: "IV012", message: "unknown location" } } } });
    expect(await recordFleetpalMovement(rec.client, ORG, movement)).toMatchObject({ code: "db_error" });
  });
});

describe("getFleetpalShelf", () => {
  it("is the open place carrying a start, read inside the org", async () => {
    const rec = createSupabaseRecorder({ tables: { stock_locations: [{ id: "loc-1", fleetpal_from: "2026-11-15T00:00:00Z" }] } });
    expect(await getFleetpalShelf(rec.client, ORG)).toEqual({ locationId: "loc-1", from: "2026-11-15T00:00:00Z" });
    expectOrgScoped(rec, ORG);
    const [q] = rec.forTable("stock_locations");
    expect(q!.filters()).toEqual(expect.arrayContaining([{ col: "active", val: true }]));
  });
});

describe("setFleetpalShelf", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "loc-1", name: "Main", code: "MAIN", address: null, active: true, fleetpal_from: null, ...over });

  it("refuses a closed place, because the ledger refuses every movement into one", async () => {
    const rec = createSupabaseRecorder({ tables: { stock_locations: [row({ active: false })] } });
    expect(await setFleetpalShelf(rec.client, ORG, "loc-1", true)).toMatchObject({ code: "location_closed" });
    expect(rec.writes()).toHaveLength(0);
  });

  it("keeps the first start when switched on twice — a re-stamp would drop what FleetPal recorded between", async () => {
    const rec = createSupabaseRecorder({ tables: { stock_locations: [row({ fleetpal_from: "2026-11-01T00:00:00Z" })] } });
    expect(await setFleetpalShelf(rec.client, ORG, "loc-1", true)).toMatchObject({ fleetpalFrom: "2026-11-01T00:00:00Z" });
    expect(rec.writes()).toHaveLength(0);
  });

  it("stamps the server's now on a place that was not following, and clears it on stop", async () => {
    const before = Date.now();
    const rec = createSupabaseRecorder({ tables: { stock_locations: [row()] } });
    await setFleetpalShelf(rec.client, ORG, "loc-1", true);
    const stamped = rec.writtenRows("stock_locations")[0]!.fleetpal_from as string;
    expect(Date.parse(stamped)).toBeGreaterThanOrEqual(before);
    const off = createSupabaseRecorder({ tables: { stock_locations: [row({ fleetpal_from: stamped })] } });
    await setFleetpalShelf(off.client, ORG, "loc-1", false);
    expect(off.writtenRows("stock_locations")[0]).toMatchObject({ fleetpal_from: null });
    expectOrgScoped(rec, ORG);
  });

  it("names the conflict when another place already follows FleetPal", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        stock_locations: (q) => (q.write ? { data: null, error: { code: "23505", message: "duplicate" } } : [row()]),
      },
    });
    expect(await setFleetpalShelf(rec.client, ORG, "loc-1", true)).toMatchObject({ code: "fleetpal_shelf_taken" });
  });
});
