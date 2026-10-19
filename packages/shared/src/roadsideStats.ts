import type { CalendarDay } from "./calendarDay.js";
import { hasOosOf, type RoadsideFeed, type RoadsideInspectionDto } from "./roadsideInspectionsContract.js";
import type { RoadsideInspectionWorkDto } from "./roadsideNextSteps.js";

/**
 * The roadside statistics over a range of days — the Operations tab's Roadside card and the strip above the
 * Roadside inspections list (INSPECTION-CHALLENGE-PLAN IC16, owner 2026-10-19; FLEET-MANAGER-HOME-PLAN Q-FM8 (a)).
 *
 * ── WHY IT WAS REBUILT ─────────────────────────────────────────────────────────────────────────
 * The card counted correctly but over the wrong days: it showed a fixed 90 days under a page whose range said
 * 30 (2026-10-19: 111 inspections and 19 vehicle OOS where the page's 30 days held 32 and 4), and it gave OOS
 * as a bare count. Every figure here is over the range the reader chose, and each is the length of a list the
 * Roadside inspections page shows with the same predicate (D-FM7, D-FM9) — the predicates are exported so the
 * page filters with them rather than restating them.
 *
 * ── THE TWO OUT-OF-SERVICE RATES ARE FMCSA'S ───────────────────────────────────────────────────
 * SMS Methodology (June 2026) §2: a Vehicle Inspection is Level 1, 2, 5 or 6; a Driver Inspection is Level 1,
 * 2, 3 or 6. A vehicle OOS rate is vehicle-OOS inspections over VEHICLE inspections (a Level 3 looks at the
 * driver only — though FMCSA's record holds 2 Level 3s with a vehicle order, measured 2026-10-19, and those
 * are left out of the rate as the method leaves them out of the denominator); the driver rate likewise.
 * Hazmat OOS is a count: its denominator (placarded Level 1/2) is too small to be a rate anyone reads.
 *
 * ── WHAT IS NOT HERE ───────────────────────────────────────────────────────────────────────────
 * No national average beside a rate: no FMCSA source for one is held in `docs/regulatory/fmcsa/`, and a
 * benchmark without its source and date is a figure nobody can check.
 */

export const VEHICLE_INSPECTION_LEVELS: readonly number[] = [1, 2, 5, 6];
export const DRIVER_INSPECTION_LEVELS: readonly number[] = [1, 2, 3, 6];

/** Which kind of inspection a rate counts over — the list's `insp` filter and the card's rows. */
export const ROADSIDE_INSPECTION_KINDS = ["vehicle", "driver"] as const;
export type RoadsideInspectionKind = (typeof ROADSIDE_INSPECTION_KINDS)[number];
export const isInspectionOfKind = (i: Pick<RoadsideInspectionDto, "level">, kind: RoadsideInspectionKind): boolean =>
  i.level != null && (kind === "vehicle" ? VEHICLE_INSPECTION_LEVELS : DRIVER_INSPECTION_LEVELS).includes(i.level);

/** Q-FM8 (a), owner 2026-10-19: clean is no violation at all. A count FMCSA left blank is not clean. */
export const isCleanInspection = (i: Pick<RoadsideInspectionDto, "violations">): boolean => i.violations === 0;

/** A share of a whole; `null` share when the whole is zero, so nothing reads as "0%" or "100%" of nothing. */
export interface RoadsideRate {
  count: number;
  of: number;
  /** count / of, 0–1; null when `of` is 0. */
  share: number | null;
}
const rate = (count: number, of: number): RoadsideRate => ({ count, of, share: of > 0 ? count / of : null });

export interface RoadsideStats {
  inspections: number;
  clean: RoadsideRate;
  vehicleOos: RoadsideRate;
  driverOos: RoadsideRate;
  hazmatOos: number;
  /** Sum of the verified CSA points the range's inspections add today; null until the work lines are known. */
  points: number | null;
  /** Inspections with a step open; null until the work lines are known. */
  needsAction: number | null;
  /** The violation categories on the most inspections, most first (ties by name), at most `TOP_CATEGORIES`. */
  topCategories: { categoryId: number; inspections: number }[];
}

export const TOP_CATEGORIES = 3;

/** The statistics of the range's inspections. `work` is the inbox's work line per inspection, when read. Pure. */
export function roadsideStats(
  rows: readonly RoadsideInspectionDto[],
  work: ReadonlyMap<string, Pick<RoadsideInspectionWorkDto, "open" | "points" | "categories">> | null,
  categoryName: (id: number) => string = String,
): RoadsideStats {
  const vehicle = rows.filter((r) => isInspectionOfKind(r, "vehicle"));
  const driver = rows.filter((r) => isInspectionOfKind(r, "driver"));
  const byCategory = new Map<number, number>();
  if (work) {
    for (const r of rows) for (const c of new Set(work.get(r.id)?.categories ?? [])) byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
  }
  return {
    inspections: rows.length,
    clean: rate(rows.filter(isCleanInspection).length, rows.length),
    vehicleOos: rate(vehicle.filter((r) => hasOosOf(r, "vehicle")).length, vehicle.length),
    driverOos: rate(driver.filter((r) => hasOosOf(r, "driver")).length, driver.length),
    hazmatOos: rows.filter((r) => hasOosOf(r, "hazmat")).length,
    points: work ? rows.reduce((n, r) => n + (work.get(r.id)?.points ?? 0), 0) : null,
    needsAction: work ? rows.filter((r) => (work.get(r.id)?.open.total ?? 0) > 0).length : null,
    topCategories: [...byCategory]
      .sort((a, b) => b[1] - a[1] || categoryName(a[0]).localeCompare(categoryName(b[0])))
      .slice(0, TOP_CATEGORIES)
      .map(([categoryId, inspections]) => ({ categoryId, inspections })),
  };
}

/** `GET /api/roadside-inspections/summary?from=&to=` — the card's answer: the range it covers, its statistics, the feed's freshness. */
export interface RoadsideSummary {
  from: CalendarDay;
  to: CalendarDay;
  stats: RoadsideStats;
  feed: RoadsideFeed;
}
