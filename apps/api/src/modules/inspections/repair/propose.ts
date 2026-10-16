import { createHash } from "node:crypto";
import { repairDueOn, wallClockInZone, type RepairCandidate, type RepairEngineOutcome } from "@silvicom/shared";
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
 */

export interface UnitToPropose {
  inspectionDate: string;
  vehicleId: string | null;
  trailerId: string | null;
  /** `roadside_violations.defect_verification_id` of each 393/396 violation on the unit. */
  defectVerifications: (string | null)[];
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
): Proposal {
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
    .sort((a, b) => a.o.openedAt.localeCompare(b.o.openedAt) || a.o.fleetpalId.localeCompare(b.o.fleetpalId))
    .map(
      ({ o, openedOn }): RepairCandidate => ({
        workOrderId: o.fleetpalId,
        reference: o.reference,
        openedOn,
        status: o.status,
        completedAt: o.completedAt,
        description: o.description,
        jobs: [...o.jobs].sort(),
      }),
    );
  return done(candidates.length === 0 ? "no_candidate" : candidates.length === 1 ? "one_candidate" : "several_candidates", candidates);
}
