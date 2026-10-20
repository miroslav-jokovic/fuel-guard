import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { IN_SERVICE_VEHICLE_STATUSES } from "@silvicom/shared";
import { listLoadActivity } from "./activity.js";

/**
 * LOADS-ACTIVITY-PLAN D-LA7 over the read: who the activity is FOR (active drivers, non-retired
 * trucks), which loads it reads (open ones and the lookback's deliveries, including one keyed ahead),
 * and that both seats of a team count. The verdicts themselves are `summarizeActivity`'s and are pinned
 * in `loadActivity.test.ts`.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-19T18:00:00Z");
const DIXON = "d1"; const HOUSTON = "d2"; const IDLE = "d3";
const TRUCK = "v1"; const PARKED = "v2";

const filter = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;
const has = (q: RecordedQuery, method: string) => q.ops.some((o) => o.method === method);
const load = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, ref: `0136${id}`, status, source: "tms", loaded: true, driver_id: DIXON, co_driver_id: HOUSTON,
  vehicle_id: TRUCK, dispatcher_external_id: "romann", ...over,
});
const stops: Record<string, unknown[]> = {
  L1: [{ load_id: "L1", seq: 1, kind: "pickup", actual_departure_at: "2026-10-14T10:00:00Z" }, { load_id: "L1", seq: 2, kind: "dropoff", actual_departure_at: "2026-10-16T10:00:00Z" }],
  // Keyed ahead: "departed" two days from now.
  L2: [{ load_id: "L2", seq: 1, kind: "dropoff", actual_departure_at: "2026-10-21T13:00:00Z" }],
};

function rig() {
  return createSupabaseRecorder({
    tables: {
      loads: (q) => (has(q, "not") ? [] : [load("L1", "delivered"), load("L2", "delivered", { driver_id: IDLE, co_driver_id: null, vehicle_id: PARKED })].filter((l) => (filter(q, "id") as string[]).includes(l.id))),
      load_stops: (q) => {
        const ids = filter(q, "load_id") as string[] | undefined;
        if (ids) return ids.flatMap((id) => stops[id] ?? []);
        return has(q, "gte") && q.ops.find((o) => o.method === "gte")?.args[0] === "actual_departure_at" ? [{ load_id: "L1" }, { load_id: "L2" }] : [];
      },
      drivers: [
        { id: DIXON, full_name: "Kim Dixon", current_hos_status: "off_duty" },
        { id: HOUSTON, full_name: "Marcus Houston", current_hos_status: "sleeper" },
        { id: IDLE, full_name: "Idle Ivan", current_hos_status: null },
      ],
      vehicles: [{ id: TRUCK, unit_number: "809" }, { id: PARKED, unit_number: "810" }],
    },
  });
}

describe("listLoadActivity", () => {
  it("credits both seats of a team delivery, with each driver's name and HOS", async () => {
    const rec = rig();
    const out = await listLoadActivity(rec.client, ORG, NOW);
    const by = new Map(out.drivers.map((d) => [d.subjectId, d]));
    expect(by.get(DIXON)).toMatchObject({ name: "Kim Dixon", hosStatus: "off_duty", lastDeliveryAt: "2026-10-16T10:00:00Z", daysWithoutLoad: 3 });
    expect(by.get(HOUSTON)).toMatchObject({ lastDeliveryAt: "2026-10-16T10:00:00Z", daysWithoutLoad: 3 });
    expectOrgScoped(rec, ORG);
  });

  it("keeps a delivery keyed ahead in McLeod, flagged, instead of losing it at the window's end", async () => {
    const out = await listLoadActivity(rig().client, ORG, NOW);
    expect(out.drivers.find((d) => d.subjectId === IDLE)).toMatchObject({ lastDeliveryAt: "2026-10-21T13:00:00Z", enteredAhead: true, daysWithoutLoad: 0 });
    expect(out.trucks.find((t) => t.subjectId === PARKED)).toMatchObject({ unit: "810", enteredAhead: true });
  });

  it("reads active drivers and in-service trucks only, and says where its history starts", async () => {
    const rec = rig();
    const out = await listLoadActivity(rec.client, ORG, NOW);
    expect(filter(rec.forTable("drivers")[0]!, "status")).toBe("active");
    expect(filter(rec.forTable("vehicles")[0]!, "status")).toEqual([...IN_SERVICE_VEHICLE_STATUSES]);
    expect(out).toMatchObject({ asOf: NOW.toISOString(), windowFrom: "2026-08-20T18:00:00.000Z", historyFrom: "2026-10-16T10:00:00Z" });
  });

  it("looks for deliveries from the lookback's start to past now, so a time keyed ahead is inside", async () => {
    const rec = rig();
    await listLoadActivity(rec.client, ORG, NOW);
    const candidate = rec.forTable("load_stops").find((q) => !filter(q, "load_id"))!;
    expect(candidate.ops.find((o) => o.method === "gte")?.args[1]).toBe("2026-08-20T18:00:00.000Z");
    expect(Date.parse(String(candidate.ops.find((o) => o.method === "lt")?.args[1]))).toBeGreaterThan(NOW.getTime());
  });
});
