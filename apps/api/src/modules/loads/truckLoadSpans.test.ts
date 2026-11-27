import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { readTruckLoadSpans } from "./truckLoadSpans.js";

/**
 * Which load a truck was on, read as spans (OUT-OF-ROUTE-MAP-ANALYSIS D-ORM2). The promises: canceled
 * loads and stops McLeod removed are not asked for, every query is org-scoped, and a truck with more
 * than 50 loads has its stops read in chunks — the URL ceiling `fetchAllPagedIn` exists for.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const idsIn = (q: RecordedQuery) => (q.ops.find((o) => o.method === "in" && o.args[0] === "load_id")?.args[1] ?? []) as string[];

function recorder(loadCount: number) {
  const loads = Array.from({ length: loadCount }, (_, i) => ({ id: `L${String(i).padStart(3, "0")}` }));
  const stops = loads.flatMap((l, i) => [
    { load_id: l.id, seq: 1, actual_arrival_at: `2026-11-${String(1 + (i % 20)).padStart(2, "0")}T08:00:00Z`, actual_departure_at: null, appointment_start: null, appointment_end: null, completed_at: null },
    { load_id: l.id, seq: 2, actual_arrival_at: null, actual_departure_at: null, appointment_start: null, appointment_end: `2026-11-${String(2 + (i % 20)).padStart(2, "0")}T18:00:00Z`, completed_at: null },
  ]);
  return createSupabaseRecorder({ tables: { loads, load_stops: (q) => stops.filter((s) => idsIn(q).includes(s.load_id)) } });
}

describe("readTruckLoadSpans", () => {
  it("spans each of the truck's loads from its stops, leaving canceled loads and removed stops unasked", async () => {
    const rec = recorder(2);
    const spans = await readTruckLoadSpans(rec.client, ORG, "veh-1");
    expect(spans).toEqual([
      { loadId: "L000", startMs: Date.parse("2026-11-01T08:00:00Z"), endMs: Date.parse("2026-11-02T18:00:00Z") },
      { loadId: "L001", startMs: Date.parse("2026-11-02T08:00:00Z"), endMs: Date.parse("2026-11-03T18:00:00Z") },
    ]);
    const loadsQuery = rec.forTable("loads")[0]!;
    expect(loadsQuery.ops).toEqual(expect.arrayContaining([{ method: "eq", args: ["vehicle_id", "veh-1"] }, { method: "neq", args: ["status", "canceled"] }]));
    expect(rec.forTable("load_stops")[0]!.ops).toContainEqual({ method: "is", args: ["mcleod_removed_at", null] });
    expectOrgScoped(rec, ORG);
  });

  it("reads the stops of a truck with 106 loads — today's most — in three chunks", async () => {
    const rec = recorder(106);
    expect(await readTruckLoadSpans(rec.client, ORG, "veh-1")).toHaveLength(106);
    expect(rec.forTable("load_stops").map((q) => idsIn(q).length)).toEqual([50, 50, 6]);
  });
});
