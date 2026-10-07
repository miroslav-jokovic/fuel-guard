import { describe, expect, it } from "vitest";
import { buildHosVehicleTimelines, type HosSegment } from "@silvicom/shared";
import { deriveAssignedVehicleSegments, type AssignmentRow } from "./vehicleDutyTimelines.js";

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
