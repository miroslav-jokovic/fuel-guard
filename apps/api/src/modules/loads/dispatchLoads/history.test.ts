import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { listAssignmentHistory } from "./history.js";

/**
 * DISPATCH-LOADS-COUNTS-PLAN D-DLC5 (2026-10-20): the attribution trail reads Samsara's driver↔vehicle
 * segments from `driver_vehicle_assignments`, names the roster's driver and truck for each, says
 * whether an open segment is still held, and lists the McLeod loads the truck was on meanwhile.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const DRIVER = "22222222-2222-4222-8222-222222222222";
const TRUCK = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-20T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const segment = (o: Record<string, unknown> = {}) => ({
  vehicle_samsara_id: "sv-773", driver_samsara_id: "sd-pete", start_at: hoursAgo(30), end_at: hoursAgo(20), updated_at: hoursAgo(20), ...o,
});
const load = (ref: string, left: string | null, delivered: string | null) => ({
  ref, vehicle_id: TRUCK, created_at: hoursAgo(100),
  stops: [
    { seq: 1, kind: "pickup", actual_departure_at: left, completed_at: null },
    { seq: 2, kind: "dropoff", actual_departure_at: delivered, completed_at: null },
  ],
});

function recorder(o: { segments?: unknown[]; drivers?: unknown[]; vehicles?: unknown[]; loads?: unknown[] }) {
  return createSupabaseRecorder({
    tables: {
      driver_vehicle_assignments: o.segments ?? [],
      drivers: (q: RecordedQuery) =>
        q.filters().some((f) => f.col === "id")
          ? (o.drivers ?? []).filter((d) => (d as { id: string }).id === q.filters().find((f) => f.col === "id")!.val)
          : (o.drivers ?? []),
      vehicles: (q: RecordedQuery) =>
        q.filters().some((f) => f.col === "id")
          ? (o.vehicles ?? []).filter((v) => (v as { id: string }).id === q.filters().find((f) => f.col === "id")!.val)
          : (o.vehicles ?? []),
      loads: o.loads ?? [],
    },
  });
}
const QUERY = { from: hoursAgo(48), to: NOW.toISOString(), limit: 50 };

describe("listAssignmentHistory", () => {
  it("names the roster's driver and truck for a Samsara segment, and the load the truck was on while it ran", async () => {
    const rec = recorder({
      segments: [segment()],
      drivers: [{ id: DRIVER, full_name: "Pete Ross", samsara_driver_id: "sd-pete" }],
      vehicles: [{ id: TRUCK, unit_number: "773", samsara_vehicle_id: "sv-773" }],
      // On the truck from 40 h ago to 25 h ago: overlaps the 30 h → 20 h segment. The other left after it ended.
      loads: [load("291013", hoursAgo(40), hoursAgo(25)), load("291099", hoursAgo(10), null)],
    });
    const { rows, nextCursor } = await listAssignmentHistory(rec.client, ORG, QUERY, NOW);
    expect(rows).toEqual([
      expect.objectContaining({
        driver_id: DRIVER, driver_name: "Pete Ross", driver_samsara_id: "sd-pete",
        vehicle_id: TRUCK, vehicle_unit: "773", vehicle_samsara_id: "sv-773",
        load_refs: ["291013"], still_held: false, from_at: hoursAgo(30), to_at: hoursAgo(20),
      }),
    ]);
    expect(nextCursor).toBeNull();
    expectOrgScoped(rec, ORG);
  });

  it("tells a segment still held from one that ended at a time Samsara no longer reports", async () => {
    const rec = recorder({
      segments: [
        segment({ start_at: hoursAgo(5), end_at: null, updated_at: hoursAgo(1) }), // refreshed an hour ago: held
        segment({ start_at: hoursAgo(40), end_at: null, updated_at: hoursAgo(30) }), // last seen 30 h ago: ended, unrecorded
      ],
      vehicles: [{ id: TRUCK, unit_number: "773", samsara_vehicle_id: "sv-773" }],
    });
    const { rows } = await listAssignmentHistory(rec.client, ORG, QUERY, NOW);
    expect(rows.map((r) => [r.still_held, r.to_at, r.last_seen_at])).toEqual([
      [true, null, hoursAgo(1)],
      [false, null, hoursAgo(30)],
    ]);
    // A Samsara driver the roster does not carry is named by the id, not invented.
    expect(rows[0]).toMatchObject({ driver_id: null, driver_name: null, driver_samsara_id: "sd-pete" });
  });

  it("asks the table for the window as an overlap, counting an open row by its last sighting, and pages by start", async () => {
    const rec = recorder({ segments: [] });
    await listAssignmentHistory(rec.client, ORG, { ...QUERY, cursor: hoursAgo(10) }, NOW);
    const q = rec.queries.find((x) => x.table === "driver_vehicle_assignments")!;
    const ops = q.ops.map((o) => `${o.method}(${o.args.map(String).join(",")})`);
    expect(ops).toContain(`lt(start_at,${NOW.toISOString()})`);
    expect(ops).toContain(`or(end_at.gt.${hoursAgo(48)},and(end_at.is.null,updated_at.gt.${hoursAgo(48)}))`);
    expect(ops).toContain(`lt(start_at,${hoursAgo(10)})`);
    expect(ops).toContain("limit(51)");
  });

  it("filters by the roster driver's Samsara id, and answers nothing for a driver who has none", async () => {
    const withId = recorder({
      segments: [segment()],
      drivers: [{ id: DRIVER, full_name: "Pete Ross", samsara_driver_id: "sd-pete" }],
      vehicles: [{ id: TRUCK, unit_number: "773", samsara_vehicle_id: "sv-773" }],
    });
    await listAssignmentHistory(withId.client, ORG, { ...QUERY, driverId: DRIVER }, NOW);
    const q = withId.queries.find((x) => x.table === "driver_vehicle_assignments")!;
    expect(q.filters()).toContainEqual({ col: "driver_samsara_id", val: "sd-pete" });

    const without = recorder({ segments: [segment()], drivers: [{ id: DRIVER, full_name: "Pete Ross", samsara_driver_id: null }] });
    const { rows } = await listAssignmentHistory(without.client, ORG, { ...QUERY, driverId: DRIVER }, NOW);
    expect(rows).toEqual([]);
    expect(without.queries.some((x) => x.table === "driver_vehicle_assignments")).toBe(false);
  });

  it("hands back a cursor when the page is full, from the last row's start", async () => {
    const segs = Array.from({ length: 3 }, (_, i) => segment({ start_at: hoursAgo(10 + i), end_at: hoursAgo(9 + i), updated_at: hoursAgo(9 + i) }));
    const rec = recorder({ segments: segs, vehicles: [{ id: TRUCK, unit_number: "773", samsara_vehicle_id: "sv-773" }] });
    const { rows, nextCursor } = await listAssignmentHistory(rec.client, ORG, { ...QUERY, limit: 2 }, NOW);
    expect(rows).toHaveLength(2);
    expect(nextCursor).toBe(hoursAgo(11));
  });
});
