import { REPORT_CHECK_NOTES, type FieldEvidence, type ReportCheckReason, type RoadsideInspectionReport } from "@silvicom/shared";

/**
 * The officer's report against the record (INSPECTION-CHALLENGE-PLAN D-IC13; Q-IC11 (a), owner 2026-10-15).
 * Pure: the read, the FMCSA row, the inspected units, the roster and Samsara's reading in; a verdict out.
 *
 * ── WHAT CONFIRMS ────────────────────────────────────────────────────────────────────────────────
 * All of: the paper's report number is FMCSA's for this inspection; no VIN on the paper is foreign to it;
 * both readers read the same licence number, and when the page's own text was read (OCR or a PDF's text)
 * it prints that number; exactly one roster driver holds it; and Samsara put that same driver on the truck.
 * Two independent sources — the paper and the telematics — naming one person by a licence number is a
 * stronger reading than a person clicking "confirm" on one of them, and every disagreement still reaches
 * a person (Q-IC11's reasoning).
 *
 * ── WHAT NEVER CONFIRMS ──────────────────────────────────────────────────────────────────────────
 * A name. It is compared and a difference is shown (`name_differs`), but spelling, middle names and two
 * drivers sharing one name make it evidence for a person, not for the engine.
 *
 * Identifiers are compared as letters and digits only: a licence printed "D123-4567-8901" is the roster's
 * "D12345678901", and FMCSA's report number "PNCK000234" is the paper's "WY PNCK000234".
 */

export interface RosterLicence {
  id: string;
  fullName: string;
  cdlNumber: string;
  cdlState: string | null;
  samsaraDriverId: string | null;
}

export interface CompareInput {
  report: RoadsideInspectionReport;
  evidence: readonly FieldEvidence[];
  inspection: { reportNumber: string | null; reportState: string | null };
  unitVins: readonly string[];
  roster: readonly RosterLicence[];
  /** The engine's reading: the one Samsara driver it names, or null when it names none. */
  samsaraDriverId: string | null;
}

export interface CompareResult {
  agrees: boolean;
  reasons: ReportCheckReason[];
  driverId: string | null;
  nameOnReport: string | null;
  licenceLast4: string | null;
}

export const compact = (v: unknown): string => (typeof v === "string" ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

/** A name's words, accents off, single letters (initials) dropped. */
const words = (name: string): string[] =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 2);

/** The same person's name when every word of the shorter is a word of the longer — order and initials aside. */
export function sameName(a: string, b: string): boolean {
  const [short, long] = [words(a), words(b)].sort((x, y) => x.length - y.length) as [string[], string[]];
  return short.length > 0 && short.every((w) => long.includes(w));
}

const VIN_MIN = 11;

export function compareReport(input: CompareInput): CompareResult {
  const { report, evidence, inspection } = input;
  const reasons: ReportCheckReason[] = [];

  // ── is it this inspection ──
  const paperNumber = compact(report.reportNumber);
  const fmcsaNumber = compact(inspection.reportNumber);
  if (!paperNumber) reasons.push("report_number_not_read");
  else if (fmcsaNumber && paperNumber !== fmcsaNumber && paperNumber !== compact(inspection.reportState) + fmcsaNumber) {
    reasons.push("report_number_mismatch");
  }

  // ── are these its units ── (FMCSA's units lag its inspections by a day; none listed means nothing to compare)
  const listed = new Set(input.unitVins.map(compact).filter((v) => v.length >= VIN_MIN));
  if (listed.size > 0 && report.units.some((u) => compact(u.vin).length >= VIN_MIN && !listed.has(compact(u.vin)))) {
    reasons.push("vin_mismatch");
  }

  // ── whose licence ──
  const ev = evidence.find((e) => e.path === "driver.licenseNumber");
  const a = compact(ev?.sources.find((s) => s.reader === "passA")?.value ?? report.driver.licenseNumber);
  const b = compact(ev?.sources.find((s) => s.reader === "passB")?.value);
  const witnesses = (ev?.sources ?? []).filter((s) => s.reader === "ocr" || s.reader === "textLayer");
  const licence = a || null;
  let driverId: string | null = null;
  let licenceDriver: RosterLicence | null = null;
  if (!licence) reasons.push("licence_not_read");
  else {
    if (a !== b) reasons.push("licence_readers_disagree");
    else if (witnesses.length > 0 && !witnesses.some((w) => Array.isArray(w.value) && (w.value as unknown[]).includes("passA"))) {
      reasons.push("licence_not_printed");
    }
    const state = compact(report.driver.licenseState);
    const holders = input.roster.filter(
      (d) => compact(d.cdlNumber) === licence && (!state || !d.cdlState || compact(d.cdlState) === state),
    );
    if (holders.length === 0) reasons.push("licence_not_on_roster");
    else if (holders.length > 1) reasons.push("licence_several_drivers");
    else {
      licenceDriver = holders[0]!;
      driverId = licenceDriver.id;
    }
  }

  // ── does Samsara agree ──
  if (!input.samsaraDriverId) reasons.push("samsara_no_driver");
  else if (licenceDriver && !licenceDriver.samsaraDriverId) reasons.push("driver_not_in_samsara");
  else if (licenceDriver && licenceDriver.samsaraDriverId !== input.samsaraDriverId) reasons.push("samsara_other_driver");

  if (licenceDriver && report.driver.name && !sameName(report.driver.name, licenceDriver.fullName)) reasons.push("name_differs");

  return {
    agrees: reasons.every((r) => REPORT_CHECK_NOTES.includes(r)) && driverId !== null,
    reasons,
    driverId,
    nameOnReport: report.driver.name,
    licenceLast4: licence ? licence.slice(-4) : null,
  };
}
