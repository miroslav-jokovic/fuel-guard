/**
 * Every PM schedule FleetPal keeps on a unit, judged against the latest meter and the calendar
 * (FLEETPAL-INTEGRATION-PLAN.md F11; MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3 "Due").
 *
 * ── ONE JUDGEMENT, THREE READERS ─────────────────────────────────────────────────────────────────
 * `pmStatus` in `@silvicom/shared` is the rule; this file only walks the rows. The dispatch board's
 * `readUnitMaintenance` beside it keeps its own narrower selection (the 6-month and the oil change,
 * one chip per kind) because a chip with a guessed kind would be a wrong chip. Here the schedule's
 * own NAME is what the page prints — "PM Reefer" (44 schedules in production, 2026-10-28), "Replace
 * Suction Manifold" (31) — so nothing is guessed and every schedule is shown, except the annual,
 * which is our record's and not FleetPal's (Q-DBV2).
 *
 * ── THE METER IS THE ROSTER'S ─────────────────────────────────────────────────────────────────────
 * Measured 2026-10-28: FleetPal's latest ODOMETER reading and `vehicles.current_odometer` (Samsara's)
 * differ by a median of 109 miles across the 227 matched trucks, and 171 of FleetPal's are under a
 * week old. Two readings of one fact a hundred miles apart would put "due" on one screen and "ok" on
 * another, so every PM reader judges on the roster's odometer — the board already does — and the
 * truck's page shows FleetPal's reading beside it as a fact (D-FP22). A trailer has no odometer here,
 * so its mileage intervals cannot be judged and say so rather than guessing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyPmName, pmStatus, type PmScheduleDto, type PmIntervalStatusDto, type PmStatus } from "@silvicom/shared";
import { readPmSchedules, toInterval, type PmIntervalRow, type PmScheduleRow, type PmUnitRow } from "./unitMaintenance.js";

const RANK: Record<PmStatus["verdict"], number> = { overdue: 0, due: 1, ok: 2 };
const worst = (a: PmStatus["verdict"] | null, b: PmStatus["verdict"]): PmStatus["verdict"] =>
  a === null || RANK[b] < RANK[a] ? b : a;

/** One schedule's reading: each interval judged, and the worst of them as the schedule's verdict. */
export function judgeSchedule(s: PmScheduleRow, intervals: readonly PmIntervalRow[], odometerMiles: number | null, now: Date): PmScheduleDto {
  const judged: PmIntervalStatusDto[] = [];
  let verdict: PmStatus["verdict"] | null = null;
  for (const i of intervals) {
    const status = pmStatus(toInterval(i), s.last_done, odometerMiles, now);
    if (!status) continue;
    judged.push({ ...status, intervalType: (i.interval_type ?? "").toUpperCase() === "ODOMETER" ? "odometer" : "time" });
    verdict = worst(verdict, status.verdict);
  }
  return { fleetpalId: s.fleetpal_id, name: s.name, kind: classifyPmName(s.name), lastDone: s.last_done, intervals: judged, verdict };
}

export interface UnitPmDue {
  unit: PmUnitRow;
  schedules: PmScheduleDto[];
}

/**
 * Every matched unit with its non-annual schedules judged — the Trucks & trailers list's "needs
 * attention" and F11's projection read this once for the whole fleet (four paged reads, no vendor
 * call). A matched unit with NO schedule is in the answer with an empty list: F11 has to clear a
 * truck whose schedule FleetPal deleted, and a reader that only met units with schedules could not.
 */
export async function readPmDueFleet(
  admin: SupabaseClient,
  orgId: string,
  odometerMilesByVehicleId: ReadonlyMap<string, number | null>,
  now: Date,
): Promise<UnitPmDue[]> {
  const { unitOf, schedules, intervalsOf } = await readPmSchedules(admin, orgId);
  const byUnit = new Map<string, UnitPmDue>();
  for (const u of unitOf.values()) if (u.vehicle_id || u.trailer_id) byUnit.set(u.fleetpal_id, { unit: u, schedules: [] });
  for (const s of schedules) {
    const entry = s.unit_fleetpal_id ? byUnit.get(s.unit_fleetpal_id) : undefined;
    if (!entry || classifyPmName(s.name) === "annual") continue;
    const odometer = entry.unit.vehicle_id ? (odometerMilesByVehicleId.get(entry.unit.vehicle_id) ?? null) : null;
    entry.schedules.push(judgeSchedule(s, intervalsOf.get(s.fleetpal_id) ?? [], odometer, now));
  }
  return [...byUnit.values()];
}
