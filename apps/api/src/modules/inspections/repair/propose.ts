import { createHash } from "node:crypto";
import { repairDueOn, violationSystems, vmrsSystem, wallClockInZone, type RepairCandidate, type RepairEngineOutcome } from "@silvicom/shared";
import type { UnitWorkOrder } from "../../fleetpal/index.js";

/**
 * What the engine proposes as one inspected unit's repair (IC11, D-IC14). Pure: the pass reads, this decides.
 *
 * In order: a unit whose every violation was repaired at the scene needs no work order (FMCSA defect
 * verification 1, Q-IC5); a unit FMCSA's record does not tie to one of ours cannot be in our shop's record;
 * a unit of ours FleetPal has no unit for cannot have a FleetPal work order. Otherwise the candidates are
 * every non-cancelled work order on the unit opened from the inspection's day through the due day, in the
 * org's zone, earliest first — the order most likely to be the repair is the one opened soonest after the
 * officer wrote it up, and a person reads the job names to decide (Q-IC14: proposed, never accepted).
 *
 * Since ic11.2 (ROADSIDE-REPAIR-FLOW-PLAN RR1) each candidate is marked with the VMRS systems on its jobs
 * that answer the unit's violations (`roadsideRepairMatch.ts`, measured 2026-11-18), and matching orders
 * sort first — the ranking Q-IC14 ruled on 2026-10-16 and the first version never built. The mark helps a
 * person; it never selects.
 */

export interface UnitToPropose {
  inspectionDate: string;
  vehicleId: string | null;
  trailerId: string | null;
  /** `roadside_violations.defect_verification_id` of each 393/396 violation on the unit. */
  defectVerifications: (string | null)[];
  /** `roadside_violations.viol_code` of the same violations (`393.47E`, …). */
  violationCodes: (string | null)[];
}

export interface Proposal {
  outcome: RepairEngineOutcome;
  dueOn: string;
  candidates: RepairCandidate[];
  /** What the pass compares to decide whether the unit's reading changed. */
  sha256: string;
}

/** FMCSA defect verification 1 = "A, repaired at scene" (MCMIS data dictionary Rev05, p. 5). */
const REPAIRED_AT_SCENE = "1";

const dayIn = (iso: string, zone: string): string => {
  const w = wallClockInZone(new Date(iso), zone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
};

export function proposeRepair(
  unit: UnitToPropose,
  fleetpal: { vehiclesInFleetpal: ReadonlySet<string>; trailersInFleetpal: ReadonlySet<string>; orders: readonly UnitWorkOrder[] },
  zone: string,
  /** FleetPal component id → VMRS code, resolved by the pass. An id missing here marks nothing. */
  codes: ReadonlyMap<string, string | null> = new Map(),
): Proposal {
  const wanted = violationSystems(unit.violationCodes);
  const matchesOf = (o: UnitWorkOrder): string[] | null => {
    if (wanted.length === 0) return null;
    const systems = new Set(o.jobComponents.map((id) => vmrsSystem(codes.get(id))).filter((x): x is string => x !== null));
    return wanted.filter((w) => systems.has(w));
  };
  const dueOn = repairDueOn(unit.inspectionDate);
  const inspDay = unit.inspectionDate.slice(0, 10);
  const done = (outcome: RepairEngineOutcome, candidates: RepairCandidate[] = []): Proposal => ({
    outcome,
    dueOn,
    candidates,
    sha256: createHash("sha256").update(JSON.stringify({ outcome, dueOn, candidates })).digest("hex"),
  });

  if (unit.defectVerifications.length > 0 && unit.defectVerifications.every((d) => d?.trim() === REPAIRED_AT_SCENE)) return done("repaired_at_scene");
  if (!unit.vehicleId && !unit.trailerId) return done("unit_not_ours");
  const inFleetpal = unit.vehicleId ? fleetpal.vehiclesInFleetpal.has(unit.vehicleId) : fleetpal.trailersInFleetpal.has(unit.trailerId!);
  if (!inFleetpal) return done("no_fleetpal_unit");

  const candidates = fleetpal.orders
    .filter((o) => (unit.vehicleId ? o.vehicleId === unit.vehicleId : o.trailerId === unit.trailerId))
    .map((o) => ({ o, openedOn: dayIn(o.openedAt, zone) }))
    .filter(({ openedOn }) => openedOn >= inspDay && openedOn <= dueOn)
    .map((x) => ({ ...x, matches: matchesOf(x.o) }))
    .sort((a, b) => Number((b.matches?.length ?? 0) > 0) - Number((a.matches?.length ?? 0) > 0) || a.o.openedAt.localeCompare(b.o.openedAt) || a.o.fleetpalId.localeCompare(b.o.fleetpalId))
    .map(
      ({ o, openedOn, matches }): RepairCandidate => ({
        workOrderId: o.fleetpalId,
        reference: o.reference,
        openedOn,
        status: o.status,
        completedAt: o.completedAt,
        description: o.description,
        jobs: [...o.jobs].sort(),
        matches,
      }),
    );
  return done(candidates.length === 0 ? "no_candidate" : candidates.length === 1 ? "one_candidate" : "several_candidates", candidates);
}
