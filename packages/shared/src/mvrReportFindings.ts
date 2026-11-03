import { toJurisdictionCode } from "./jurisdictions.js";
import { MVR_LOOKBACK_YEARS } from "./mvrJurisdictions.js";
import type { MvrReport } from "./mvrReportContract.js";

/**
 * The checking layer over a read MVR (HIRING-WORKFLOW-AUDIT §14, OF6, Q-OF5; owner 2026-11-03: *"we will use
 * AI as checking layer"*). The reader transcribes; THIS decides what a recruiter must look at, in code, where
 * every rule is a line a test pins (memory: "SQL returns a measurement, TS owns the verdict" — here the model
 * returns the measurement).
 *
 * ── TWO WEIGHTS, AND NEITHER IS A HIRING DECISION ──────────────────────────────────────────────
 * `stop` — the record says something that, if true, means this licence cannot be used today (not valid, a
 * withdrawal still in force, expired, not medically certified) or that the record is not this applicant's
 * (another licence number). `check` — something a recruiter reads before deciding (a violation in the last
 * three years, a crash, a name that does not match exactly, a date the reader could not place). Neither
 * refuses anything: a person records the MVR, and the carrier's hiring rules are the carrier's. A finding
 * names what the PAPER says, so the recruiter checks it against the PDF, not against us.
 *
 * ⚠ An unreadable value is a `check`, never silence. A status the reader returned null for is "the status
 * could not be read", because a missing word read as "fine" is the vacuous-green this repo keeps paying for.
 */
export type MvrFindingWeight = "stop" | "check";
export interface MvrFinding {
  code:
    | "no_record" | "licence_number_differs" | "state_differs" | "name_differs"
    | "status_not_valid" | "status_unread" | "licence_expired" | "date_unread"
    | "medical_not_certified" | "medical_expired" | "medical_unread"
    | "withdrawal_in_force" | "withdrawal_recent" | "violations_recent" | "accidents_recent";
  weight: MvrFindingWeight;
  message: string;
}

/** The words states print for a licence that may be used. Anything else is read as a stop for a person to check. */
const VALID_STATUS = /^(VALID|ACTIVE|LICENSED|LICENCED|CLEAR|ELIGIBLE|IN FORCE|CURRENT)\b/;

/** A printed date as a calendar day — MM/DD/YYYY (US), YYYY-MM-DD, MM-DD-YYYY or MM/DD/YY. Null when it is none of them. */
export function printedDay(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return day(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(v);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return day(y, +m[1]!, +m[2]!);
  }
  return null;
}
function day(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString().slice(0, 10);
}

const alnum = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const nameTokens = (v: string | null | undefined) =>
  new Set((v ?? "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((t) => t.length > 1));

function yearsBefore(today: string, years: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return day(y - years, m, Math.min(d, 28))!;
}

export interface MvrApplicantFacts {
  fullName: string | null;
  cdlNumber: string | null;
  cdlState: string | null;
}

export function mvrReportFindings(report: MvrReport, applicant: MvrApplicantFacts, today: string): MvrFinding[] {
  const out: MvrFinding[] = [];
  const add = (code: MvrFinding["code"], weight: MvrFindingWeight, message: string) => out.push({ code, weight, message });

  if (report.noRecordFound === true) {
    add("no_record", "stop", "The record says no record was found for this request. Check the licence number and state it was ordered for.");
    return out;
  }

  // Is it this applicant's record at all? The licence number is the identity; the name is a second look.
  const readNo = alnum(report.licenseNumber);
  const ourNo = alnum(applicant.cdlNumber);
  if (readNo && ourNo && readNo !== ourNo) {
    add("licence_number_differs", "stop", `The record is for licence ${report.licenseNumber}; the applicant's licence on file is ${applicant.cdlNumber}.`);
  }
  const readState = toJurisdictionCode(report.licenseState);
  const ourState = toJurisdictionCode(applicant.cdlState);
  if (readState && ourState && readState !== ourState) {
    add("state_differs", "check", `The record is from ${readState}; the applicant's licence on file is from ${ourState}. A record from another state they held a licence in is expected — make sure it is the one you meant.`);
  }
  const ours = nameTokens(applicant.fullName);
  const theirs = nameTokens(report.driverName);
  if (ours.size > 0 && theirs.size > 0 && ![...ours].every((t) => theirs.has(t))) {
    add("name_differs", "check", `The record's name is "${report.driverName}"; the applicant is "${applicant.fullName}".`);
  }

  // The licence: status, the commercial privilege, expiry.
  for (const [label, status] of [["licence", report.licenseStatus], ["commercial privilege", report.commercialStatus]] as const) {
    if (status === null) {
      if (label === "licence") add("status_unread", "check", "The licence status could not be read. Read it on the PDF.");
      continue;
    }
    if (!VALID_STATUS.test(status.trim().toUpperCase())) {
      add("status_not_valid", "stop", `The ${label} status reads "${status}".`);
    }
  }
  const expires = printedDay(report.licenseExpires);
  if (report.licenseExpires && !expires) add("date_unread", "check", `The licence expiry "${report.licenseExpires}" is not a date the checker can read.`);
  if (expires && expires < today) add("licence_expired", "stop", `The licence expired ${report.licenseExpires}.`);

  // §391.41 / §383.71: the medical certification the state holds.
  const med = report.medicalCertificationStatus?.trim().toUpperCase() ?? null;
  if (med === null) {
    add("medical_unread", "check", "The record shows no medical certification status. Check the medical card instead.");
  } else if (/\bNOT\b|\bNON\b|UNCERT|EXPIRED|DOWNGRAD/.test(med)) {
    add("medical_not_certified", "stop", `The medical certification reads "${report.medicalCertificationStatus}".`);
  }
  const medExpires = printedDay(report.medicalExpires);
  if (medExpires && medExpires < today) add("medical_expired", "stop", `The medical certificate the state holds expired ${report.medicalExpires}.`);

  // Withdrawals: one still in force stops; one that ended inside the look-back is read.
  const since = yearsBefore(today, MVR_LOOKBACK_YEARS);
  for (const w of report.withdrawals) {
    const what = `${w.kind ?? "A withdrawal"}${w.reason ? ` (${w.reason})` : ""}, from ${w.from ?? "an unprinted date"}`;
    const to = printedDay(w.to);
    if (w.to === null || (to !== null && to >= today)) add("withdrawal_in_force", "stop", `${what} has no end, or ends after today.`);
    else if (to === null) add("date_unread", "check", `${what} ends "${w.to}", which the checker cannot read.`);
    else if (to >= since) add("withdrawal_recent", "check", `${what} ended ${w.to}.`);
  }

  // Events inside the three years §391.23 looks back over. An undated one is counted — a person reads it.
  const recent = (events: MvrReport["violations"]) =>
    events.filter((e) => {
      const d = printedDay(e.date);
      return d === null || d >= since;
    });
  const v = recent(report.violations);
  if (v.length > 0) {
    const cmv = v.filter((e) => /^(Y|YES|CMV|TRUE)/i.test(e.commercialVehicle ?? "")).length;
    add("violations_recent", "check", `${v.length} violation${v.length === 1 ? "" : "s"} in the last ${MVR_LOOKBACK_YEARS} years${cmv ? `, ${cmv} in a commercial vehicle` : ""}.`);
  }
  const a = recent(report.accidents);
  if (a.length > 0) add("accidents_recent", "check", `${a.length} crash${a.length === 1 ? "" : "es"} in the last ${MVR_LOOKBACK_YEARS} years.`);

  return out.sort((x, y) => (x.weight === y.weight ? 0 : x.weight === "stop" ? -1 : 1));
}
