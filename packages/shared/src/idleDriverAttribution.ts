/**
 * Attribute idle to drivers via time-ranged driver↔vehicle assignments (pure, testable). The foundation records
 * idle per TRUCK; a fair driver idle score needs it per DRIVER — so each time-stamped bucket (an avoidable-idle
 * park session, or a day's engine-on/idle time) is credited to whoever was assigned to that truck at that
 * instant. Buckets on a truck with no assignment at that time fall to the null "unattributed" driver, surfaced
 * so it reads as a data-coverage gap, not a person to coach.
 */

export interface DriverAssignment {
  vehicleSamsaraId: string;
  driverSamsaraId: string;
  startMs: number;
  /** null = open / ongoing. */
  endMs: number | null;
}

/** One time-stamped quantity to attribute. avoidable/engineOn/idle are seconds (0 when not applicable). */
export interface IdleBucket {
  vehicleSamsaraId: string;
  atMs: number;
  avoidableSec: number;
  engineOnSec: number;
  idleSec: number;
}

export interface DriverIdleTotals {
  driverSamsaraId: string | null; // null = no assignment covered this bucket
  avoidableSec: number;
  engineOnSec: number;
  idleSec: number;
}

/**
 * The driver assigned to `vehicleSamsaraId` at instant `tMs` (inclusive of an open-ended assignment), or null.
 * Later-starting assignments win when ranges overlap, so a re-assignment takes effect from its start.
 */
export function driverAt(assignments: DriverAssignment[], vehicleSamsaraId: string, tMs: number): string | null {
  let best: DriverAssignment | null = null;
  for (const a of assignments) {
    if (a.vehicleSamsaraId !== vehicleSamsaraId) continue;
    if (tMs < a.startMs) continue;
    if (a.endMs != null && tMs > a.endMs) continue;
    if (!best || a.startMs > best.startMs) best = a;
  }
  return best ? best.driverSamsaraId : null;
}

/** Credit every bucket to the driver assigned at its instant and total per driver (null = unattributed). */
export function attributeDriverIdle(buckets: IdleBucket[], assignments: DriverAssignment[]): DriverIdleTotals[] {
  const by = new Map<string | null, { avoidableSec: number; engineOnSec: number; idleSec: number }>();
  for (const b of buckets) {
    const driver = driverAt(assignments, b.vehicleSamsaraId, b.atMs);
    const t = by.get(driver) ?? { avoidableSec: 0, engineOnSec: 0, idleSec: 0 };
    t.avoidableSec += b.avoidableSec;
    t.engineOnSec += b.engineOnSec;
    t.idleSec += b.idleSec;
    by.set(driver, t);
  }
  return [...by.entries()].map(([driverSamsaraId, t]) => ({ driverSamsaraId, ...t }));
}
