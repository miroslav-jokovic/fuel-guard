import { readStatus, type PspOutcome } from "./status.js";

/**
 * The thin projection of a PSP driver report (PSP-PLAN D-PSP2).
 *
 * ~150 vendor fields per record, every one of them typed `"string"` in the guide, is not a schema to
 * model. **The raw response is the evidence and stays whole; this is the index over it** — which is
 * what makes a parsing bug a re-derivation rather than a second purchase at full price.
 *
 * Everything here is defensive on purpose. The published OpenAPI declares **no `required` field on
 * any schema** (PSP-PLAN §2.6), so a codegen'd client would happily hand us a report with no status,
 * and every number arrives as a string that may not be one.
 */

export interface PspSummary {
  /** Roadside inspections, and the driver's own out-of-service rate. */
  driverInspCount: number;
  driverOOSCount: number;
  /** §2.6: typed int32 by the vendor, so NOT assumed to be a percentage or a fraction. */
  driverOOSRateRaw: number | null;
  vehicleInspCount: number;
  vehicleOOSCount: number;
  crashes: number;
  crashesWithFatalities: number;
  crashesWithInjuries: number;
  towaways: number;
  /** §10.5 — a crash FMCSA deemed non-preventable must never be counted against the driver. */
  crashesNotPreventable: number;
  hazmatReleases: number;
}

export interface PspInspectionRecord {
  inspectionId: string | null;
  reportState: string | null;
  reportNumber: string | null;
  inspectionDate: string | null;
  inspectionLevelId: string | null;
  /** The carrier whose truck the driver was in — the strong key for the employment cross-match. */
  usdotNumber: string | null;
  carrierName: string | null;
  totalDriverViolations: number;
  totalDriverOOS: number;
  violations: PspViolation[];
}

export interface PspViolation {
  inspViolationId: number | null;
  /** The FMCSR section, e.g. "392.2C". */
  partNoSection: string | null;
  sectionDesc: string | null;
  outOfService: boolean;
  citationNumber: string | null;
  /** §10.4 — 1 = conviction of the original charge, 2 = conviction of a different one. */
  citationResult: number | null;
  citationResultDesc: string | null;
}

export interface PspCrashRecord {
  reportState: string | null;
  reportNumber: string | null;
  reportDate: string | null;
  /** The carrier, from either of the two fields a crash record may carry it in. */
  usdotNumber: string | null;
  carrierName: string | null;
  fatalities: number;
  injuries: number;
  towAway: boolean;
  /** §10.5. `notPreventable` is the only thing that says a crash was not the driver's to avoid. */
  notPreventable: boolean;
  notPreventableDesc: string | null;
}

export interface PspReport {
  outcome: PspOutcome;
  status: number | null;
  statusDetail: number | null;
  statusDescription: string | null;
  billed: boolean;
  authCode: string | null;
  internalRefId: string | null;
  requestDate: string | null;
  /** The licence PSP matched — asserted against the one we asked for before anything is filed. */
  driverLicenseNumber: string | null;
  driverLicenseState: string | null;
  monitor: boolean;
  summary: PspSummary;
  inspections: PspInspectionRecord[];
  crashes: PspCrashRecord[];
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number") return String(v);
  return null;
};

/** Vendor numbers arrive as strings, as numbers, or absent. `null` when it is none of those. */
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const count = (v: unknown): number => num(v) ?? 0;

/**
 * PSP's flag fields are free text: "Y", "yes", "1", "N". Anything that is not affirmative is false,
 * which is the safe direction for `outOfService` and — importantly — the CAUTIOUS direction for
 * `notPreventable`: an unparseable value leaves the crash counted, which is how it arrived.
 */
const flag = (v: unknown): boolean => {
  const s = str(v)?.trim().toUpperCase();
  return s === "Y" || s === "YES" || s === "1" || s === "TRUE";
};

function parseViolation(raw: unknown): PspViolation {
  const v = rec(raw);
  return {
    inspViolationId: num(v.inspViolationId),
    partNoSection: str(v.partNoSection),
    sectionDesc: str(v.sectionDesc),
    outOfService: flag(v.outOfServiceIndicator),
    citationNumber: str(v.citationNumber),
    citationResult: num(v.citationResult),
    citationResultDesc: str(v.citationResultDesc),
  };
}

function parseInspection(raw: unknown): PspInspectionRecord {
  const i = rec(raw);
  return {
    inspectionId: str(i.inspectionId),
    reportState: str(i.reportState),
    reportNumber: str(i.reportNumber),
    inspectionDate: str(i.inspectionDate),
    inspectionLevelId: str(i.inspectionLevelId),
    usdotNumber: str(i.usdotNumber),
    carrierName: str(i.carrierName),
    totalDriverViolations: count(i.totalDriverViolations),
    totalDriverOOS: count(i.totalDriverOOS),
    violations: arr(i.inspectionViolations).map(parseViolation),
  };
}

function parseCrash(raw: unknown): PspCrashRecord {
  const c = rec(raw);
  return {
    reportState: str(c.reportState),
    reportNumber: str(c.reportNumber),
    reportDate: str(c.reportDate),
    // A crash carries the carrier in `censusNumber` or `uploadDOTNumber` depending on its source
    // (§5.4.3); neither is authoritative alone, so the first present one wins and the raw response
    // keeps both.
    usdotNumber: str(c.censusNumber) ?? str(c.uploadDOTNumber),
    carrierName: str(c.carrierName),
    fatalities: count(c.fatalities),
    injuries: count(c.injuries),
    towAway: flag(c.towAway),
    notPreventable: flag(c.notPreventable),
    notPreventableDesc: str(c.notPreventableDesc),
  };
}

/**
 * Parse one `DriverReportResponse` — the element type of what `POST /Records` returns (verified
 * against the production OpenAPI, not the guide's example).
 */
export function parsePspReport(raw: unknown): PspReport {
  const top = rec(raw);
  const info = rec(top.driverInformationResponse);
  const record = rec(info.driverRecord);
  const infoSummary = rec(info.driverInfoSummary);
  const reportSummary = rec(top.driverReportSummaryResponse);

  const status = num(info.status);
  const read = status === null ? null : readStatus(status);

  return {
    // No status at all is `unknown`, not success. The OpenAPI marks nothing required, so an absent
    // status is a shape the vendor is entitled to send and we are not entitled to guess at.
    outcome: read?.outcome ?? "unknown",
    status,
    statusDetail: num(info.statusDetail),
    statusDescription: str(info.statusDescription),
    billed: read?.billed ?? true,
    authCode: str(info.authCode),
    internalRefId: str(info.internalRefId),
    requestDate: str(info.requestDate),
    driverLicenseNumber: str(info.driverLicenseNumber),
    driverLicenseState: str(info.driverLicenseState),
    monitor: top.monitor === true,
    summary: {
      driverInspCount: count(infoSummary.driverInspCount),
      driverOOSCount: count(infoSummary.driverOOSCount),
      driverOOSRateRaw: num(infoSummary.driverOOSRate),
      vehicleInspCount: count(infoSummary.vehicleInspCount),
      vehicleOOSCount: count(infoSummary.vehicleOOSCount),
      crashes: count(reportSummary.numCrashes),
      crashesWithFatalities: count(reportSummary.numCrashesWithFatalities),
      crashesWithInjuries: count(reportSummary.numCrashesWithInjuries),
      towaways: count(reportSummary.numTowaways),
      crashesNotPreventable: count(reportSummary.numCrashesNotPreventable),
      hazmatReleases: count(reportSummary.numHazmatReleases),
    },
    inspections: arr(record.inspectionRecords).map(parseInspection),
    crashes: arr(record.crashRecords).map(parseCrash),
  };
}

/**
 * A clean record is a SUCCESS with nothing in it (§8.3: *"A driver record returned in the response,
 * that does not have any crashes in the last 5 years, or inspections in the last 3 years, are valid
 * records"*). The UI must say "clean", never "no data found" — they are opposite claims about the
 * same bytes, and one of them is an accusation.
 */
export const isCleanRecord = (report: PspReport): boolean =>
  report.outcome === "success" && report.inspections.length === 0 && report.crashes.length === 0;
