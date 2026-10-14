import { stateTimeZoneCandidates, wallClockToUtc } from "@silvicom/shared";
import type {
  AttributionBasis,
  AttributionConfidence,
  AttributionLocationCheck,
  AttributionOutcome,
  AttributionZoneMethod,
} from "@silvicom/shared";

/**
 * When a roadside inspection happened and who was driving — read from Samsara's answers, with no I/O
 * here (INSPECTION-CHALLENGE-PLAN IC5; D-IC7, D-IC8). `attribute.ts` fetches and freezes; this file
 * only reads what was frozen, so a reading can be re-run byte for byte from the snapshots.
 *
 * ── THE INSTANT: THE STATE PROPOSES, THE GPS DECIDES (D-IC8) ───────────────────────────────────
 * The report's HHMM has no zone. Each zone the report's state could be on (`stateTimeZoneCandidates`)
 * gives one candidate interval. The inspection is the one in which the truck stood still: measured on
 * 698 at the Erwinville scale (LA, 2026-09-22, report 13:04–13:27), the truck stops at 18:04Z,
 * reports 0 mph until 18:42Z and leaves — while an hour either side it is at highway speed. A truck
 * parked long enough to be still in two candidates leaves the zone unresolved rather than guessed.
 *
 * "Stood still" is the SHARE of the interval the truck spent under 3 mph, each fix's speed held until
 * the next. Measured 2026-10-14 over 145 real inspections: the right zone reads 0.9–1.0, the wrong one
 * 0–0.4, and a handful read ~1.0 in both (parked through both). The first rule — "every fix under
 * 3 mph" — called 49 of the 145 moving, because a truck repositions at a scale and the officer's end
 * time often falls after it has left. Half the interval is the line.
 *
 * ── THE DRIVER: SAMSARA'S ASSIGNMENTS, NEVER A GUESS (D-IC7) ───────────────────────────────────
 * Every driver assigned to the truck within two hours of the inspection is a candidate. One driver,
 * logged in during it or both before and after it, is a strong reading — measured on the same stop,
 * Samsara CLOSED the HOS assignment at 18:04Z and reopened it at 18:42Z, so "during" alone would have
 * found nobody. Two drivers, a passenger (a team), or none goes to a person.
 */

const MIN = 60_000;
/** How far either side of the inspection the assignments, the GPS and the frozen window reach (D-IC4). */
export const ATTRIBUTION_WINDOW_MS = 120 * MIN;
/** At or above this a fix is moving. Measured: a truck standing at a scale reports exactly 0.0. */
const STOPPED_BELOW_MPH = 3;
/** The officer's start is rounded to the minute and the truck is still rolling in: skip up to this much of it. */
const SETTLE_MS = 5 * MIN;
/** A stopped truck reports rarely (four fixes in 38 minutes at Erwinville); a fix this old still holds. */
const HOLD_MS = 30 * MIN;
/** The share of a candidate the truck must spend stopped to be "stood still" there (measured: 0.9–1.0 right, 0–0.4 wrong). */
export const STOPPED_SHARE = 0.5;

export interface Interval {
  startMs: number;
  endMs: number;
}
export interface Candidate extends Interval {
  zone: string;
}
export interface GpsFix {
  ms: number;
  mph: number;
  /** The two-letter state of Samsara's reverse-geocoded address, or null when it names none. */
  state: string | null;
}
export interface Assignment extends Interval {
  driverId: string;
  driverName: string | null;
  passenger: boolean;
}

/** `HHMM` → minutes after midnight, or null. */
function minutesOf(hhmm: string | null): number | null {
  const m = hhmm?.trim().match(/^([01]\d|2[0-3])([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * One interval per zone the report's state could be on. Empty when the report has no date or no
 * start time. A missing end is the start; an end before the start crossed midnight.
 */
export function candidateIntervals(date: string | null, startHhmm: string | null, endHhmm: string | null, reportState: string | null): Candidate[] {
  const start = minutesOf(startHhmm);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || start === null) return [];
  const end = minutesOf(endHhmm) ?? start;
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return stateTimeZoneCandidates(reportState).map((zone) => {
    const startMs = wallClockToUtc({ year, month, day, hour: Math.floor(start / 60), minute: start % 60, second: 0 }, zone);
    return { zone, startMs, endMs: startMs + ((end - start + 1440) % 1440) * MIN };
  });
}

/** The smallest interval holding every candidate — where the assignments are read when the zone is unresolved. */
export const hullOf = (cs: readonly Interval[]): Interval => ({
  startMs: Math.min(...cs.map((c) => c.startMs)),
  endMs: Math.max(...cs.map((c) => c.endMs)),
});

/** The two-letter state closing Samsara's `formattedLocation` ("US 190;LA 1, LA, 70767" → LA), or null. */
export function stateOfAddress(address: string | null | undefined): string | null {
  const m = address?.trim().match(/(?:^|,\s*)([A-Z]{2})(?:,?\s*\d{5}(?:-\d{4})?)?$/);
  return m ? m[1]! : null;
}

/** The interval without its first minutes: the officer's start is rounded, and the truck is still rolling in. */
export const settledOf = (c: Interval): Interval => {
  // A report whose start and end are the same minute is read as that minute.
  const endMs = Math.max(c.endMs, c.startMs + MIN);
  return { startMs: c.startMs + Math.min(SETTLE_MS, (endMs - c.startMs) / 2), endMs };
};

type Verdict = { kind: "stationary"; share: number; state: string | null } | { kind: "moving"; share: number } | { kind: "no_gps" };

/**
 * What the GPS says of one candidate interval: the share of its settled part the truck spent stopped,
 * each fix's speed held until the next fix (or `HOLD_MS`, whichever is sooner). Time no fix speaks
 * for counts as neither. The place is the state of the fix nearest its middle.
 */
export function judge(fixes: readonly GpsFix[], c: Interval): Verdict {
  const s = settledOf(c);
  let stopped = 0;
  let known = 0;
  let nearest: GpsFix | null = null;
  const middle = (s.startMs + s.endMs) / 2;
  fixes.forEach((f, i) => {
    const from = Math.max(f.ms, s.startMs);
    const to = Math.min(fixes[i + 1]?.ms ?? Infinity, f.ms + HOLD_MS, s.endMs);
    if (to <= from) return;
    known += to - from;
    if (f.mph < STOPPED_BELOW_MPH) stopped += to - from;
    if (!nearest || Math.abs(f.ms - middle) < Math.abs(nearest.ms - middle)) nearest = f;
  });
  if (known === 0) return { kind: "no_gps" };
  const share = stopped / (s.endMs - s.startMs);
  return share >= STOPPED_SHARE ? { kind: "stationary", share, state: (nearest as GpsFix | null)?.state ?? null } : { kind: "moving", share };
}

export interface InstantReading {
  zoneMethod: AttributionZoneMethod;
  locationCheck: AttributionLocationCheck;
  /** The inspection's interval, or null when unresolved. */
  instant: Candidate | null;
}

/** D-IC8. `fixes` must be sorted by time. */
export function resolveInstant(candidates: readonly Candidate[], fixes: readonly GpsFix[], reportState: string | null): InstantReading {
  if (candidates.length === 0) return { zoneMethod: "unresolved", locationCheck: "no_gps", instant: null };
  const verdicts = candidates.map((c) => ({ c, v: judge(fixes, c) }));
  const stopped = verdicts.filter((x): x is { c: Candidate; v: Extract<Verdict, { kind: "stationary" }> } => x.v.kind === "stationary");
  // A federal report names no state, so any state the truck stood in is "in" it.
  const place = (state: string | null): AttributionLocationCheck =>
    state === null ? "unplaced" : reportState?.trim().toUpperCase() === "US" || state === reportState?.trim().toUpperCase() ? "confirmed" : "other_state";

  if (stopped.length === 1) return { zoneMethod: "gps", locationCheck: place(stopped[0]!.v.state), instant: stopped[0]!.c };
  // Stood still in several: the place is where it stood longest.
  const longest = [...stopped].sort((a, b) => b.v.share - a.v.share)[0];
  const locationCheck: AttributionLocationCheck = longest
    ? place(longest.v.state)
    : verdicts.some((x) => x.v.kind === "moving") ? "moving" : "no_gps";
  if (candidates.length === 1) return { zoneMethod: "state_only", locationCheck, instant: candidates[0]! };
  return { zoneMethod: "unresolved", locationCheck, instant: null };
}

export interface DriverCandidate {
  samsaraDriverId: string;
  name: string | null;
  passenger: boolean;
  segments: { start: string; end: string }[];
}
export interface DriverReading {
  outcome: Extract<AttributionOutcome, "one_driver" | "several_drivers" | "no_assignment">;
  driver: { samsaraDriverId: string; name: string | null } | null;
  basis: AttributionBasis | null;
  candidates: DriverCandidate[];
}

const overlaps = (a: Interval, b: Interval) => a.startMs <= b.endMs && b.startMs <= a.endMs;

/** D-IC7: who the assignments put on the truck within `ATTRIBUTION_WINDOW_MS` of `at`. */
export function readDriver(assignments: readonly Assignment[], at: Interval): DriverReading {
  const window = { startMs: at.startMs - ATTRIBUTION_WINDOW_MS, endMs: at.endMs + ATTRIBUTION_WINDOW_MS };
  const inWindow = assignments.filter((a) => overlaps(a, window)).sort((a, b) => a.startMs - b.startMs);
  const byDriver = new Map<string, DriverCandidate>();
  for (const a of inWindow) {
    const c = byDriver.get(a.driverId) ?? { samsaraDriverId: a.driverId, name: a.driverName, passenger: false, segments: [] };
    c.passenger ||= a.passenger;
    c.segments.push({ start: new Date(a.startMs).toISOString(), end: new Date(a.endMs).toISOString() });
    byDriver.set(a.driverId, c);
  }
  const candidates = [...byDriver.values()];
  if (candidates.length === 0) return { outcome: "no_assignment", driver: null, basis: null, candidates };
  // A passenger is a second person in the cab even when it is the only assignment we see.
  if (candidates.length > 1 || candidates[0]!.passenger) return { outcome: "several_drivers", driver: null, basis: null, candidates };

  const only = candidates[0]!;
  // Against the SETTLED interval, as the GPS is: on the Erwinville stop the assignment closed at
  // 18:04:10Z against a report start of 18:04 — ten seconds of the officer's rounding, not a driver
  // logged in during the inspection.
  const core = settledOf(at);
  let basis: AttributionBasis;
  if (inWindow.some((a) => overlaps(a, core))) basis = "covering";
  else {
    const before = inWindow.some((a) => a.endMs < core.startMs);
    const after = inWindow.some((a) => a.startMs > core.endMs);
    basis = before && after ? "bracketing" : before ? "before_only" : "after_only";
  }
  return { outcome: "one_driver", driver: { samsaraDriverId: only.samsaraDriverId, name: only.name }, basis, candidates };
}

const strong = (b: AttributionBasis | null) => b === "covering" || b === "bracketing";

/**
 * High when one driver covers or brackets the inspection AND the reading cannot be wrong about when:
 *   - the zone was settled and the GPS did not put the truck moving or in another state; or
 *   - the zone is unresolved, but the truck stood still in the report's state and the SAME driver
 *     covers or brackets every candidate — who was driving does not depend on which zone it was
 *     (`atEachCandidate`, one reading per candidate).
 * Everything else is low, and goes to a person (D-IC7).
 */
export function confidenceOf(instant: InstantReading, driver: DriverReading, atEachCandidate: readonly DriverReading[] = []): AttributionConfidence | null {
  if (driver.outcome !== "one_driver") return null;
  if (instant.zoneMethod !== "unresolved") {
    const usable = instant.locationCheck !== "moving" && instant.locationCheck !== "other_state";
    return usable && strong(driver.basis) ? "high" : "low";
  }
  const stoodInState = instant.locationCheck === "confirmed" || instant.locationCheck === "unplaced";
  const sameEverywhere =
    atEachCandidate.length > 0 &&
    atEachCandidate.every((r) => r.outcome === "one_driver" && r.driver?.samsaraDriverId === driver.driver?.samsaraDriverId && strong(r.basis));
  return stoodInState && sameEverywhere ? "high" : "low";
}

export interface Reading {
  instant: InstantReading;
  driver: DriverReading;
  confidence: AttributionConfidence | null;
}

/** The whole reading of one inspection from its frozen answers: when, where, who, and how sure. */
export function readAttribution(
  candidates: readonly Candidate[],
  fixes: readonly GpsFix[],
  assignments: readonly Assignment[],
  reportState: string | null,
): Reading {
  const instant = resolveInstant(candidates, fixes, reportState);
  const driver = readDriver(assignments, instant.instant ?? hullOf(candidates));
  const atEachCandidate = instant.instant ? [] : candidates.map((c) => readDriver(assignments, c));
  return { instant, driver, confidence: confidenceOf(instant, driver, atEachCandidate) };
}

/** Samsara's `/fleet/vehicles/stats/history?types=gps` vehicle record → fixes in time order. */
export function fixesOf(record: { gps?: unknown } | undefined): GpsFix[] {
  const raw = Array.isArray(record?.gps) ? (record!.gps as Record<string, unknown>[]) : [];
  return raw
    .map((p) => ({
      ms: Date.parse(String(p.time)),
      mph: Number(p.speedMilesPerHour ?? 0),
      state: stateOfAddress((p.reverseGeo as { formattedLocation?: string } | undefined)?.formattedLocation),
    }))
    .filter((f) => Number.isFinite(f.ms) && Number.isFinite(f.mph))
    .sort((a, b) => a.ms - b.ms);
}

/** Samsara's `/fleet/driver-vehicle-assignments` rows → assignments; an open one (no end) runs to `openUntilMs`. */
export function assignmentsOf(rows: readonly Record<string, unknown>[], openUntilMs: number): Assignment[] {
  return rows.flatMap((r) => {
    const driver = r.driver as { id?: unknown; name?: unknown } | undefined;
    const startMs = Date.parse(String(r.startTime));
    const endMs = r.endTime ? Date.parse(String(r.endTime)) : openUntilMs;
    if (!driver?.id || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
    return [{ driverId: String(driver.id), driverName: typeof driver.name === "string" ? driver.name : null, passenger: r.isPassenger === true, startMs, endMs }];
  });
}
