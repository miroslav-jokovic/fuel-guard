import { describe, expect, it } from "vitest";
import { buildHosVehicleTimelines, type HosSegment } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import {
  deriveAssignedVehicleSegments,
  readAssignmentsOverlapping,
  type AssignmentRow,
} from "./vehicleDutyTimelines.js";

const H = 3_600_000;
const T0 = Date.parse("2026-09-01T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const END = T0 + 48 * H;

const vehicles = new Map([
  ["sv1", "v1"],
  ["sv2", "v2"],
]);

function seg(driverId: string, status: HosSegment["status"], fromH: number, toH: number | null, vehicleId: string | null = null): HosSegment {
  return { driverId, vehicleId, status, startMs: T0 + fromH * H, endMs: toH == null ? null : T0 + toH * H };
}

function asg(vehicle: string, driver: string, fromH: number, toH: number | null): AssignmentRow {
  return {
    vehicle_samsara_id: vehicle,
    driver_samsara_id: driver,
    start_at: iso(T0 + fromH * H),
    end_at: toH == null ? null : iso(T0 + toH * H),
  };
}

/** Each truck's timeline, built the way readVehicleDutyTimelines builds it. */
function timelinesOf(derived: Map<string, HosSegment[]>) {
  return Object.fromEntries(
    [...buildHosVehicleTimelines(derived, T0, END)].map(([v, t]) => [v, t.intervals]),
  );
}

/** The pre-2026-10-06 derivation: one clip per assignment ROW. Kept here as the ruler. */
function perRowReference(
  assignments: AssignmentRow[],
  bySamsaraDriver: Map<string, HosSegment[]>,
): Map<string, HosSegment[]> {
  const out = new Map<string, HosSegment[]>();
  for (const a of assignments) {
    const vehicleId = vehicles.get(a.vehicle_samsara_id);
    if (vehicleId == null) continue;
    const s = Date.parse(a.start_at);
    const e = a.end_at == null ? END : Date.parse(a.end_at);
    if (!(e > s)) continue;
    for (const segment of bySamsaraDriver.get(a.driver_samsara_id) ?? []) {
      if (segment.vehicleId != null && segment.vehicleId !== vehicleId) continue;
      const cs = Math.max(segment.startMs, s);
      const ce = Math.min(segment.endMs ?? END, e);
      if (!(ce > cs)) continue;
      out.set(vehicleId, [...(out.get(vehicleId) ?? []), { ...segment, vehicleId, startMs: cs, endMs: ce }]);
    }
  }
  return out;
}

describe("deriveAssignedVehicleSegments", () => {
  // Overlapping, contained, touching and open-ended rows for one pair; a team driver on the same truck
  // with a conflicting kind (ambiguity must survive); a logbook entry naming another truck (log wins);
  // an unknown truck; and a zero-length row.
  const bySamsaraDriver = new Map<string, HosSegment[]>([
    ["d1", [seg("d1", "sleeper", 0, 10), seg("d1", "on_duty", 10, 12), seg("d1", "driving", 12, 20, "v2"), seg("d1", "off_duty", 20, null)]],
    ["d2", [seg("d2", "on_duty", 4, 8), seg("d2", "sleeper", 8, 30)]],
  ]);
  const assignments = [
    asg("sv1", "d1", 0, 6),
    asg("sv1", "d1", 2, 4), // contained
    asg("sv1", "d1", 5, 11), // overlapping
    asg("sv1", "d1", 11, 14), // touching
    ...Array.from({ length: 40 }, () => asg("sv1", "d1", 1, 9)), // the production shape: many copies
    asg("sv1", "d1", 22, null), // open-ended
    asg("sv1", "d2", 3, 9),
    asg("sv9", "d1", 0, 48), // truck we do not know
    asg("sv1", "d1", 30, 30), // zero length
  ];

  it("credits each duty segment to a truck once per merged assignment span, not once per row", () => {
    // Incident 2026-10-06: overlapping rows made 11.9M copies of 111k segments in production and held
    // the API's event loop during every sync_hos.
    const derived = deriveAssignedVehicleSegments(assignments, vehicles, bySamsaraDriver, END);
    const d1 = (derived.get("v1") ?? []).filter((s) => s.driverId === "d1");
    expect(d1.map((s) => [s.status, (s.startMs - T0) / H, ((s.endMs ?? END) - T0) / H])).toEqual([
      ["sleeper", 0, 10],
      ["on_duty", 10, 12],
      ["off_duty", 22, 48],
    ]);
  });

  it("builds exactly the timelines the per-row derivation built", () => {
    const merged = timelinesOf(deriveAssignedVehicleSegments(assignments, vehicles, bySamsaraDriver, END));
    const reference = timelinesOf(perRowReference(assignments, bySamsaraDriver));
    expect(merged).toEqual(reference);
    // The team driver's conflicting kind is still reported as ambiguous, not merged away.
    expect((merged.v1 as { ambiguous: boolean }[]).some((i) => i.ambiguous)).toBe(true);
  });

  it("never re-attributes a segment whose own logbook names a different truck", () => {
    const derived = deriveAssignedVehicleSegments(assignments, vehicles, bySamsaraDriver, END);
    expect((derived.get("v1") ?? []).some((s) => s.status === "driving")).toBe(false);
    expect(derived.has("v2")).toBe(false);
  });
});

describe("readAssignmentsOverlapping", () => {
  const ORG = "org-1";
  const FROM = "2026-09-01T00:00:00.000Z";
  const TO = "2026-10-01T00:00:00.000Z";
  // PostgREST prints microseconds; the last row of the full page carries them on purpose.
  const LAST_START = "2026-09-14T08:15:02.077123+00:00";
  const fullPage: AssignmentRow[] = Array.from({ length: 1000 }, (_, i) => ({
    vehicle_samsara_id: `sv${i}`,
    driver_samsara_id: `d${i}`,
    start_at: i === 999 ? LAST_START : "2026-09-01T00:00:00+00:00",
    end_at: null,
  }));
  const shortPage: AssignmentRow[] = [
    { vehicle_samsara_id: "sv-tail", driver_samsara_id: "d-tail", start_at: "2026-09-20T00:00:00+00:00", end_at: null },
  ];
  const orFilters = (q: RecordedQuery) => q.ops.filter((op) => op.method === "or").map((op) => op.args[0]);
  /** A fixture that answers on the query: the page after a cursor is the short one. */
  const paged = () =>
    createSupabaseRecorder({
      tables: { driver_vehicle_assignments: (q) => (orFilters(q).length > 1 ? shortPage : fullPage) },
    });

  it("asks for the rows after the last one it read, never for an offset", async () => {
    const rec = paged();
    const rows = await readAssignmentsOverlapping(rec.client, ORG, FROM, TO);
    expect(rows).toHaveLength(1001);
    const [first, second] = rec.forTable("driver_vehicle_assignments");
    expect(rec.forTable("driver_vehicle_assignments")).toHaveLength(2);
    expect(orFilters(first!)).toEqual([`end_at.is.null,end_at.gte.${FROM}`]);
    expect(orFilters(second!)).toEqual([
      `end_at.is.null,end_at.gte.${FROM}`,
      `start_at.gt."${LAST_START}",` +
        `and(start_at.eq."${LAST_START}",vehicle_samsara_id.gt."sv999"),` +
        `and(start_at.eq."${LAST_START}",vehicle_samsara_id.eq."sv999",driver_samsara_id.gt."d999")`,
    ]);
    for (const q of [first!, second!]) {
      expect(q.ops.some((op) => op.method === "range")).toBe(false);
      expect(q.ops.filter((op) => op.method === "limit").map((op) => op.args[0])).toEqual([1000]);
      // The order is the table's whole key after the org, so no two rows tie at a page boundary.
      expect(q.ops.filter((op) => op.method === "order").map((op) => op.args[0])).toEqual([
        "start_at",
        "vehicle_samsara_id",
        "driver_samsara_id",
      ]);
    }
    expectOrgScoped(rec, ORG);
  });

  it("stops after one request when the window holds less than a page", async () => {
    const rec = createSupabaseRecorder({ tables: { driver_vehicle_assignments: shortPage } });
    expect(await readAssignmentsOverlapping(rec.client, ORG, FROM, TO)).toEqual(shortPage);
    expect(rec.forTable("driver_vehicle_assignments")).toHaveLength(1);
  });

  it("quotes a cursor value so a comma or a quote in an id cannot rewrite the filter", async () => {
    const odd = [...fullPage.slice(0, 999), { ...fullPage[999]!, vehicle_samsara_id: 'a,b"c\\d' }];
    const rec = createSupabaseRecorder({
      tables: { driver_vehicle_assignments: (q) => (orFilters(q).length > 1 ? [] : odd) },
    });
    await readAssignmentsOverlapping(rec.client, ORG, FROM, TO);
    const second = rec.forTable("driver_vehicle_assignments")[1]!;
    expect(String(orFilters(second)[1])).toContain('vehicle_samsara_id.gt."a,b\\"c\\\\d"');
  });

  it("refuses to return a partial read when a page fails", async () => {
    const rec = createSupabaseRecorder({
      tables: { driver_vehicle_assignments: { data: null, error: { message: "boom" } } },
    });
    await expect(readAssignmentsOverlapping(rec.client, ORG, FROM, TO)).rejects.toThrow(
      "Duty timeline assignment read failed: boom",
    );
  });
});
