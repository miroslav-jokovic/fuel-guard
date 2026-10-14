import { z } from "zod";
import { lastDaysStart, type CalendarDay } from "./calendarDay.js";
import type { RoadsideInspectionSmsDto } from "./roadsideSmsContract.js";
import type { RoadsideAttributionDto } from "./roadsideAttributionContract.js";

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

/**
 * FMCSA's names for the codes the inspection record carries as numbers — from the MCMIS Vehicle
 * Inspection File data dictionary, Rev 05 of 2025-10-15
 * (`docs/regulatory/fmcsa/MCMIS_Vehicle_Inspection_File_Data_Dictionary_Rev05.pdf`, pp. 4–8; plan
 * Q-IC5). Copied as printed, so a reader sees FMCSA's word, not ours. A code outside a table (a later
 * edition adding one) reads as its number, never as a guess.
 */
export const INSPECTION_LEVEL_NAMES: Readonly<Record<number, string>> = {
  1: "Full",
  2: "Walk-Around",
  3: "Driver-Only",
  4: "Special Study",
  5: "Terminal",
};

/** `INSP_VIOLATION_CATEGORY_ID` → its description (dictionary pp. 6–8). */
export const VIOLATION_CATEGORY_NAMES: Readonly<Record<number, string>> = {
  1: "Medical Certificate",
  2: "False Log Book",
  3: "No Log Book, Log Not Current, General Log Violations",
  4: "10/15 Hours",
  5: "15/20 Hours",
  6: "60/70/80 Hours",
  7: "All Other Hours-Of-Service",
  8: "Disqualified Drivers",
  9: "Drugs",
  10: "Alcohol",
  11: "Seat Belt",
  12: "Traffic Enforcement",
  13: "Radar Detectors",
  14: "All Other Driver Violations",
  15: "Brakes, Out of Adjustment",
  16: "Brakes, All Other Violations",
  17: "Coupling Devices",
  18: "Fuel Systems",
  19: "Frames",
  20: "Lighting",
  21: "Steering Mechanism",
  22: "Suspension",
  23: "Tires",
  24: "Wheels, Studs, Clamps, Etc.",
  25: "Load Securement",
  26: "Windshield",
  27: "Exhaust Discharge",
  28: "Emergency Equipment",
  29: "Periodic Inspection",
  30: "All Other Vehicle Defects",
  31: "Shipping Papers",
  32: "Improper Placarding",
  33: "Accepting Shipment Improperly Marked",
  34: "Improper Blocking and Bracing",
  35: "No Retest and Inspection (Cargo Tank)",
  36: "No Remote Shutoff Control",
  37: "Use of Non-specification Container",
  38: "Emergency Response",
  39: "All Other HM Violations",
  40: "Failure to Obey Traffic Control Device",
  41: "Following Too Close",
  42: "Improper Lane Change",
  43: "Improper Passing",
  44: "Reckless Driving",
  45: "Speeding",
  46: "Improper Turns",
  47: "Size and Weight",
  48: "Failure to yield right of way",
  49: "State/Local Hours of Service",
  99: "Unknown",
};

/**
 * `DEFECT_VERIFICATION_ID` (dictionary p. 5): what became of the defect after the inspection. Read for
 * an out-of-service order — "repaired at scene" beside a disputed order is evidence of its own.
 */
export const DEFECT_VERIFICATION_NAMES: Readonly<Record<number, string>> = {
  1: "Repaired at scene",
  2: "Towed or escorted to repair",
  3: "Not out of service",
  4: "Other",
  99: "Unknown or unverified",
};

/** The level as FMCSA names it: "2 · Walk-Around"; just the number for a code the table lacks. */
export const inspectionLevelLabel = (level: number | null): string | null =>
  level == null ? null : INSPECTION_LEVEL_NAMES[level] ? `${level} · ${INSPECTION_LEVEL_NAMES[level]}` : String(level);

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
  /** FMCSA's violation category, named (`VIOLATION_CATEGORY_NAMES`); the number when the table lacks it. */
  category: string | null;
  /** What became of the defect (`DEFECT_VERIFICATION_NAMES`); null when FMCSA left it blank. */
  defectVerification: string | null;
  citationNumber: string | null;
  /** The court results FMCSA holds for this violation's citation, as FMCSA words them. */
  courtResults: string[];
}

/**
 * `GET /api/roadside-inspections/:id` — one inspection as FMCSA records it (INSPECTION-CHALLENGE-PLAN §6,
 * the Inspection page's header, units and violations, and each violation's CSA points). The driver, the
 * resolved instant and cases are IC4–IC6's and are not here: FMCSA's public record does not name the
 * driver, and a guessed one is what D-IC7 forbids.
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
  /** CSA points, measured today (`roadsideSmsContract.ts`); null when no Appendix A edition is in force. */
  sms: RoadsideInspectionSmsDto | null;
  /** Who was driving, as the engine read it from Samsara and as a person decided it (IC5, D-IC7). */
  attribution: RoadsideAttributionDto;
}

/**
 * How current our copy of FMCSA's record is (INSPECTION-CHALLENGE-PLAN §4.1 "Freshness", IC1c). One
 * definition, read by the list and the card (the "as of" line) and by the scheduler's alert, so the
 * page never calls fresh what the alert calls late.
 *
 *   ours_late    our last successful fetch is older than 36 h. The scheduler runs a due org hourly
 *                and a day's run is due after 24 h, so 36 h means at least twelve ticks have failed.
 *   fmcsa_late   our fetch is current but FMCSA's own `rowsUpdatedAt` for the inspection file is older
 *                than 72 h: the source stopped publishing, and our copy is only as new as it.
 *   never        no fetch has ever succeeded for this org.
 */
export const FMCSA_OURS_LATE_HOURS = 36;
export const FMCSA_SOURCE_LATE_HOURS = 72;
export type RoadsideFeedState = "fresh" | "ours_late" | "fmcsa_late" | "never";

export const roadsideFeedSchema = z.object({
  /** When our last successful fetch of the inspection file finished. */
  fetchedAt: z.iso.datetime({ offset: true }).nullable(),
  /** FMCSA's `rowsUpdatedAt` for the inspection file at that fetch: when the source last published. */
  sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  state: z.enum(["fresh", "ours_late", "fmcsa_late", "never"]),
});
export type RoadsideFeed = z.infer<typeof roadsideFeedSchema>;

const HOUR_MS = 3_600_000;
export function roadsideFeedState(fetchedAt: string | null, sourceUpdatedAt: string | null, nowMs: number): RoadsideFeedState {
  const fetched = fetchedAt ? Date.parse(fetchedAt) : NaN;
  if (!Number.isFinite(fetched)) return "never";
  if (nowMs - fetched > FMCSA_OURS_LATE_HOURS * HOUR_MS) return "ours_late";
  const source = sourceUpdatedAt ? Date.parse(sourceUpdatedAt) : NaN;
  // A run that did not report the source's date says nothing about the source, so it is not late.
  if (Number.isFinite(source) && nowMs - source > FMCSA_SOURCE_LATE_HOURS * HOUR_MS) return "fmcsa_late";
  return "fresh";
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
  /** How current the record behind these figures is (IC1c). */
  feed: roadsideFeedSchema,
});
export type RoadsideSummary = z.infer<typeof roadsideSummarySchema>;

/** The summary from the window's list. One definition, so the server's count cannot drift from the filter. */
export function summarizeRoadside(from: CalendarDay, rows: readonly RoadsideInspectionDto[], feed: RoadsideFeed): RoadsideSummary {
  const count = (kind: RoadsideOosKind) => rows.filter((r) => hasOosOf(r, kind)).length;
  return { from, inspections: rows.length, driverOos: count("driver"), vehicleOos: count("vehicle"), hazmatOos: count("hazmat"), feed };
}
