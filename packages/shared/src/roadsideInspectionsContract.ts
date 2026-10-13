import { z } from "zod";
import { lastDaysStart, type CalendarDay } from "./calendarDay.js";

/**
 * `GET /api/roadside-inspections` and `/summary` — our FMCSA roadside inspections as a list, and the
 * Operations tab's Roadside card as that list measured (INSPECTION-CHALLENGE-PLAN §6, the Inspections
 * inbox's first slice; FLEET-MANAGER-HOME-PLAN FM5, Q-FM7 (a)).
 *
 * ── THE LIST IS WHAT FMCSA RECORDS TODAY ───────────────────────────────────────────────────────
 * Rows come from `roadside_inspections` (0458), the projection of FMCSA's open-data feed, and only
 * the ones whose record FMCSA still serves: a record that aged out of the three-year window or was
 * removed keeps its typed row there, marked (`vanished_at`), but it is no longer on the carrier's
 * record and no longer counts against it. Case and task columns ("has candidate", "needs task") are
 * IC4's and are not here yet.
 *
 * ── THE THREE OUT-OF-SERVICE KINDS OVERLAP, SO THEY ARE NEVER ADDED ───────────────────────────
 * Each kind is "inspections with at least one OOS order of that kind", FMCSA's own unit for its OOS
 * rates. They are not exclusive: a hazmat OOS violation is also counted in the vehicle (or driver)
 * figure — measured 2026-10-13, all 30 inspections whose `oos_total` differs from the sum of the
 * three are exactly that overlap. A total of the three would count those inspections twice.
 */
export const ROADSIDE_OOS_KINDS = ["driver", "vehicle", "hazmat"] as const;
export type RoadsideOosKind = (typeof ROADSIDE_OOS_KINDS)[number];

/** How far back the list looks. FMCSA publishes three years, so "all" is at most that. */
export const ROADSIDE_PERIODS = ["90d", "365d", "all"] as const;
export type RoadsidePeriod = (typeof ROADSIDE_PERIODS)[number];

/** The card's window (plan §4 card 10): the last 90 calendar days, today included. */
export const ROADSIDE_CARD_PERIOD: RoadsidePeriod = "90d";

/**
 * The first calendar day a period includes, or null for "all". `today` is the carrier's day
 * (`todayInZone` in the org zone) — the server cuts the card's window and the page cuts the list's
 * with this one function, so "last 90 days" is the same 90 days on both.
 */
export function roadsidePeriodStart(period: RoadsidePeriod, today: CalendarDay): CalendarDay | null {
  if (period === "90d") return lastDaysStart(today, 90);
  if (period === "365d") return lastDaysStart(today, 365);
  return null;
}

export interface RoadsideInspectionUnitDto {
  /** Position on the report: 1 is the power unit, 2 the first trailer. */
  seq: number | null;
  /** FMCSA's unit type, read: 11 → tractor, 9 → trailer, anything else → other. */
  kind: "tractor" | "trailer" | "other";
  /** The officer's "company number" as written, which is what the office calls the unit. */
  companyNumber: string | null;
  plate: string | null;
  plateState: string | null;
  /**
   * Whether the projection tied this unit to exactly one truck or trailer of ours (VIN, plate or unit
   * number, 0458). False is shown, never hidden: D-IC7 keeps an unmatched unit in front of a person
   * rather than guessing it is ours.
   */
  matched: boolean;
}

export interface RoadsideInspectionDto {
  id: string;
  reportNumber: string | null;
  reportState: string | null;
  /** The calendar day on the report — already the carrier's local day, so never shifted by a zone. */
  inspectionDate: CalendarDay | null;
  level: number | null;
  locationDesc: string | null;
  hazmatPlacardRequired: boolean | null;
  /**
   * FMCSA's own counts from the inspection record. Null where FMCSA left one blank (none of 1,394 on
   * 2026-10-13) — a blank is not a zero, and a list that later filters for "no violations" must not
   * count it as one.
   */
  violations: number | null;
  driverOos: number | null;
  vehicleOos: number | null;
  hazmatOos: number | null;
  /** Absent from the summary's read, which counts rows and never shows a unit. */
  units?: RoadsideInspectionUnitDto[];
}

/** How the projection tied a unit to ours (0458's `match_method`, the three that are a match). */
export const ROADSIDE_MATCH_METHODS = ["vin", "plate", "unit_number"] as const;
export type RoadsideMatchMethod = (typeof ROADSIDE_MATCH_METHODS)[number];

export interface RoadsideUnitDetailDto extends RoadsideInspectionUnitDto {
  make: string | null;
  vin: string | null;
  /** A CVSA decal was issued for this unit. */
  decal: boolean | null;
  /** Shown beside a match because unit number is the weakest of the three (0458, D-IC7). Null when unmatched. */
  matchedBy: RoadsideMatchMethod | null;
  /** Our truck, when the match was a tractor; no FK, so the page links it only to a reader who can open it. */
  vehicleId: string | null;
}

export interface RoadsideViolationDto {
  id: string;
  seq: number | null;
  /** The code exactly as FMCSA wrote it (`393.47D2-BLTBD`); IC3 maps it to SMS Appendix A, not this. */
  code: string | null;
  description: string | null;
  /** Who the officer wrote it against: the driver, or the unit at this position on the report. */
  against: { driver: true } | { unitSeq: number } | null;
  outOfService: boolean | null;
  citationNumber: string | null;
  /** The court results FMCSA holds for this violation's citation, as FMCSA words them. */
  courtResults: string[];
}

/**
 * `GET /api/roadside-inspections/:id` — one inspection as FMCSA records it (INSPECTION-CHALLENGE-PLAN §6,
 * the Inspection page's header, units and violations). The driver, the resolved instant, SMS weights
 * and cases are IC4–IC6's and are not here: FMCSA's public record does not name the driver, and a
 * guessed one is what D-IC7 forbids.
 */
export interface RoadsideInspectionDetailDto extends Omit<RoadsideInspectionDto, "units"> {
  /** The report's local clock times, HHMM as written, in the inspection's own zone — never shifted. */
  startTime: string | null;
  endTime: string | null;
  /** FMCSA's facility code: F a fixed site (a scale), R the roadside. */
  facility: "fixed" | "roadside" | null;
  postAccident: boolean | null;
  shipperName: string | null;
  grossWeightLb: number | null;
  oosTotal: number | null;
  units: RoadsideUnitDetailDto[];
  /** The violations themselves, in report order (`violations` above is FMCSA's count of them). */
  violationList: RoadsideViolationDto[];
}

/** Count accessor per kind — the one place a kind names its column, for the list's filter and the card. */
const OOS_COUNT: Record<RoadsideOosKind, (i: RoadsideInspectionDto) => number | null> = {
  driver: (i) => i.driverOos,
  vehicle: (i) => i.vehicleOos,
  hazmat: (i) => i.hazmatOos,
};

/** Does this inspection carry an out-of-service order of this kind? The list's filter and the card's count. */
export const hasOosOf = (inspection: RoadsideInspectionDto, kind: RoadsideOosKind): boolean => (OOS_COUNT[kind](inspection) ?? 0) > 0;

/**
 * The card's figures: each the length of the list `/roadside-inspections?period=90d[&oos=<kind>]`
 * shows, computed on the server by filtering that list with `hasOosOf` (D-FM7, D-FM9).
 * `from` is the window's first day, so the page and the card can be checked against each other.
 */
export const roadsideSummarySchema = z.object({
  from: z.iso.date(),
  inspections: z.number().int().min(0),
  driverOos: z.number().int().min(0),
  vehicleOos: z.number().int().min(0),
  hazmatOos: z.number().int().min(0),
});
export type RoadsideSummary = z.infer<typeof roadsideSummarySchema>;

/** The summary from the window's list. One definition, so the server's count cannot drift from the filter. */
export function summarizeRoadside(from: CalendarDay, rows: readonly RoadsideInspectionDto[]): RoadsideSummary {
  const count = (kind: RoadsideOosKind) => rows.filter((r) => hasOosOf(r, kind)).length;
  return { from, inspections: rows.length, driverOos: count("driver"), vehicleOos: count("vehicle"), hazmatOos: count("hazmat") };
}
