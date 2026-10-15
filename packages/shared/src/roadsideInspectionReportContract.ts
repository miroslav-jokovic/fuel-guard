import { z } from "zod";
import type { FieldCriticality } from "./shippingDocumentContract.js";

/**
 * RoadsideInspectionReport — the `roadside_inspection_report` profile's contract
 * (INSPECTION-CHALLENGE-PLAN.md D-IC13, IC10; DOCUMENT-READER-PLAN.md D-DR1).
 *
 * ── WHY THIS IS READ AT ALL ─────────────────────────────────────────────────────────────────────
 * Measured on production 2026-10-15: none of FMCSA's six open datasets carries the driver's name, licence
 * or date of birth — FMCSA strips them before publishing. The officer's report (the Driver/Vehicle
 * Examination Report the driver is handed) is the only document that names the driver. The inspection
 * module compares what is read here with FMCSA's row, our units and Samsara's driver (D-IC13); this
 * contract only says what the paper prints.
 *
 * ── DATA ONLY, AS PRINTED ───────────────────────────────────────────────────────────────────────
 * Every value is the paper's text, never an interpretation, exactly as the shipping document's (D-DR2):
 * a date is the printed string, a licence number keeps its dashes, a violation code keeps its letters.
 * Normalising for the comparison is the consumer's, in code, where a test can see it.
 *
 * ── WHAT IS NOT READ ────────────────────────────────────────────────────────────────────────────
 * The driver's date of birth, home address and the carrier's address. The comparison needs a name and a
 * licence; what we do not transcribe cannot leak (the posture FleetPal's vendor fields take, D-FP2).
 *
 * Every field defaults to null (a list to []), so `parse({})` is the empty document — the same rule as
 * `shippingDocumentSchema`, for the same three writers.
 */

const str = () => z.string().nullable().default(null);

export const ROADSIDE_INSPECTION_REPORT_PROFILE_VERSION = "roadside_inspection_report-1.0.0";

export const reportUnitSchema = z.object({
  unitNumber: z.string().nullable().default(null).describe("The unit's number on the report (1 for the power unit, 2 for the first trailer)."),
  unitType: str(),
  companyNumber: z.string().nullable().default(null).describe("The company's own unit number, if printed (not the plate)."),
  vin: z.string().nullable().default(null).describe("The vehicle identification number exactly as printed, every character."),
  plate: str(),
  plateState: str(),
});
export type ReportUnit = z.infer<typeof reportUnitSchema>;

export const reportViolationSchema = z.object({
  code: z.string().nullable().default(null).describe("The violation code or regulation section exactly as printed (393.9TS, 395.8E)."),
  unitNumber: z.string().nullable().default(null).describe("The unit the violation is on, as printed (1, 2, D for driver)."),
  outOfService: z.boolean().nullable().default(null).describe("True when this violation is marked out of service, false when marked not, null when the report marks neither."),
  citationNumber: z.string().nullable().default(null).describe("The citation or ticket number printed beside this violation; null when none."),
  description: str(),
});
export type ReportViolation = z.infer<typeof reportViolationSchema>;

export const roadsideInspectionReportSchema = z.object({
  reportNumber: z.string().nullable().default(null).describe("The inspection report number exactly as printed, with any state prefix."),
  reportState: z.string().nullable().default(null).describe("The state that issued the report, as printed."),
  inspectionDate: z.string().nullable().default(null).describe("The inspection date exactly as printed."),
  startTime: str(),
  endTime: str(),
  level: z.string().nullable().default(null).describe("The inspection level as printed (I, II, III, 1, 2, 3 …)."),
  location: str(),
  carrierUsdot: z.string().nullable().default(null).describe("The carrier's USDOT number as printed."),
  driver: z
    .object({
      name: z.string().nullable().default(null).describe("The driver's full name as printed, in the printed order."),
      licenseNumber: z.string().nullable().default(null).describe("The driver's licence number exactly as printed, every character."),
      licenseState: z.string().nullable().default(null).describe("The state that issued the driver's licence, as printed."),
    })
    .default({ name: null, licenseNumber: null, licenseState: null }),
  units: z.array(reportUnitSchema).default([]).describe("Each vehicle on the report, in printed order."),
  violations: z.array(reportViolationSchema).default([]).describe("Each violation on the report, in printed order."),
});
export type RoadsideInspectionReport = z.infer<typeof roadsideInspectionReportSchema>;

export const emptyRoadsideInspectionReport = (): RoadsideInspectionReport => roadsideInspectionReportSchema.parse({});

/**
 * The fields the inspection module decides on (D-IC13): which inspection this is, which truck, which
 * driver. A wrong one of these confirms the wrong driver, so they graduate at the engine's bar.
 */
const DECIDING_PATHS = [/^reportNumber$/, /^reportState$/, /^driver\.licenseNumber$/, /^driver\.licenseState$/, /^units\[\d+\]\.vin$/];
export function roadsideReportFieldCriticality(path: string): FieldCriticality {
  return DECIDING_PATHS.some((rx) => rx.test(path)) ? "engine" : "standard";
}
