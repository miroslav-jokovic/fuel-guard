/**
 * Combine one week's per-driver inputs into a fleet-relative leaderboard (pure). Steps (§3.2–3.4):
 *   1. eligibility gate (miles + drive-hours + Safety present),
 *   2. normalize each component across the ELIGIBLE cohort that has it,
 *   3. weighted combine over the components present for each driver (weights renormalized).
 * Only eligible drivers get a weekFinal; ineligible drivers keep their raw sub-scores for coaching.
 */
import type {
  DriverWeekInput,
  DriverWeekScore,
  IneligibleReason,
  NormalizationMethod,
  PerformanceSettings,
  WeekLeaderboard,
} from "./types.js";
import { normalizeComponent } from "./normalize.js";

const r1 = (n: number) => Math.round(n * 10) / 10;

function ineligibleReason(inp: DriverWeekInput, s: PerformanceSettings): IneligibleReason | null {
  if (inp.safetyScore == null) return "no_safety";
  if ((inp.miles ?? 0) < s.minDistanceMi) return "below_min_miles";
  if ((inp.driveHours ?? 0) < s.minDriveHours) return "below_min_hours";
  return null;
}

export function combineWeek(
  inputs: DriverWeekInput[],
  settings: PerformanceSettings,
): WeekLeaderboard {
  const rows: DriverWeekScore[] = inputs.map((inp) => {
    const reason = ineligibleReason(inp, settings);
    return {
      driverId: inp.driverId,
      driverName: inp.driverName ?? null,
      safetyScore: inp.safetyScore,
      efficiencyScore: inp.efficiencyScore,
      idleScore: inp.idleScore,
      safetyPct: null,
      efficiencyPct: null,
      idlePct: null,
      miles: inp.miles,
      driveHours: inp.driveHours,
      eligible: reason == null,
      ineligibleReason: reason,
      weekFinal: null,
    };
  });

  const eligibleIdx = rows.map((r, i) => (r.eligible ? i : -1)).filter((i) => i >= 0);
  const eligibleCount = eligibleIdx.length;

  const methodUsed: NormalizationMethod =
    settings.normalizationMethod === "percentile" && eligibleCount < settings.minCohortForPercentile
      ? "zscore"
      : settings.normalizationMethod;

  // ── Idling sub-score (§3.3a). Compute each eligible driver's effective idle score by the configured basis:
  //   • "intensity" — avoidable idle as a share of ENGINE-ON hours (drive + idle): exposure-normalized and
  //     money-aligned, so it grows with ABSOLUTE avoidable waste and is fair across mileage.
  //   • "share"     — the driver's own discipline ratio (avoidable ÷ their idle), magnitude-blind.
  // Then a CLEAN driver (real drive activity, zero avoidable idle observed) scores a PERFECT 100 rather than a
  // missing component — but only when the fleet actually has idle data this week; if idle is absent fleet-wide
  // (feed down) it stays missing and the grade renormalizes over safety + efficiency.
  const basis = settings.idleScoreBasis;
  const clamp01 = (n: number) => Math.max(0, Math.min(100, n));
  const anyObservedIdle = eligibleIdx.some((i) => inputs[i]!.idleScore != null);
  for (const i of eligibleIdx) {
    const inp = inputs[i]!;
    const row = rows[i]!;
    if (inp.idleScore != null) {
      row.idleScore =
        basis === "intensity" &&
        inp.idleDiscretionaryHours != null &&
        inp.engineOnHours != null &&
        inp.engineOnHours > 0
          ? r1(clamp01(100 * (1 - inp.idleDiscretionaryHours / inp.engineOnHours)))
          : inp.idleScore;
    } else if (anyObservedIdle) {
      row.idleScore = 100; // eligible + drove, no avoidable idle while the fleet has idle data → perfect discipline
    } else {
      row.idleScore = null; // no idle data fleet-wide this week → genuinely missing → renormalize
    }
  }

  const components: {
    key: "safety" | "efficiency" | "idling";
    get: (r: DriverWeekScore) => number | null;
    set: (r: DriverWeekScore, v: number) => void;
  }[] = [
    { key: "safety", get: (r) => r.safetyScore, set: (r, v) => (r.safetyPct = v) },
    { key: "efficiency", get: (r) => r.efficiencyScore, set: (r, v) => (r.efficiencyPct = v) },
    { key: "idling", get: (r) => r.idleScore, set: (r, v) => (r.idlePct = v) },
  ];

  const coverage = { safety: 0, efficiency: 0, idling: 0 };
  for (const comp of components) {
    const present = eligibleIdx.filter((i) => comp.get(rows[i]!) != null);
    coverage[comp.key] = present.length;
    if (present.length === 0) continue;
    const norm = normalizeComponent(
      present.map((i) => comp.get(rows[i]!)!),
      methodUsed,
    );
    present.forEach((i, k) => comp.set(rows[i]!, norm[k]!));
  }

  const w = settings.weights;
  for (const i of eligibleIdx) {
    const r = rows[i]!;
    let num = 0;
    let den = 0;
    if (r.safetyPct != null) {
      num += w.safety * r.safetyPct;
      den += w.safety;
    }
    if (r.efficiencyPct != null) {
      num += w.efficiency * r.efficiencyPct;
      den += w.efficiency;
    }
    if (r.idlePct != null) {
      num += w.idling * r.idlePct;
      den += w.idling;
    }
    r.weekFinal = den > 0 ? r1(num / den) : null;
  }

  return { rows, eligibleCount, methodUsed, coverage };
}
