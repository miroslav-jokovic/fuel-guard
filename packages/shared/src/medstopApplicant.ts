import type { DonorGender } from "./applicantScreeningContract.js";
import { US_JURISDICTION_CODES } from "./applicantScreeningContract.js";

/**
 * Creating the applicant in Med-Stop from Part 1 (MEDSTOP-PLAN.md §7A.13, D-MS1, batch UX5c) — the
 * pure half: which applicants are skipped and why, and the form that is sent.
 *
 * ── THE FORM IS MED-STOP'S OWN ────────────────────────────────────────────────────────────────
 * The owner asked that what we send match Med-Stop's form EXACTLY. So we do not compose a body: the
 * api GETs `/Employee/new` (Med-Stop's blank form, 46 keys = `Dto.WizEmployee`'s 46, checked 2026-10-13)
 * and this function fills in ours and hands the SAME object back, every key kept. Med-Stop's names,
 * its branch id and its defaults (dotagency FMCSA, dotstatus Y, applicationdate today, annualreview
 * +1 year, country US) cannot drift from what is sent, because they are what is sent.
 *
 * What we set, and the measurement behind each (GET only, 2026-10-13, §7A.13):
 * - status `APPLICANT`, category `DRIVER`, drivingtype `NON-EXCEPTED INTERSTATE`, idclass `CDL` — what
 *   every one of the office's 28 hand-entered applicants holds (owner: "as recommended").
 * - gender in capitals — `/List/GENDER` is MALE | FEMALE.
 * - phone1 as `(999) 999-9999`, dates as the form's own `YYYY-MM-DDT00:00:00Z` — the shapes Med-Stop's
 *   own records carry.
 * - idnumber = the CDL number: no SSN, ever (O-5).
 * - startdate EMPTY (null — how the form writes an empty date) although the spec marks it required:
 *   an applicant has not started, and every hand-entered applicant has none. If Med-Stop refuses it,
 *   the create is refused loudly and the office adds the person by hand (first-create runbook).
 */

/** The 24 keys `Dto.WizEmployee` marks required (`E_VALID_REQ`), read from the spec 2026-10-13. */
export const MEDSTOP_APPLICANT_REQUIRED = [
  "dotagency", "branchid", "birthdate", "lname", "fname", "gender", "status", "dotstatus",
  "applicationdate", "startdate", "annualreview", "category", "address", "city", "state", "zip",
  "phone1", "drivingtype", "idclass", "license", "licensestate", "licenseclass", "licenseexpiration", "idnumber",
] as const;

/** Required by the spec, deliberately left empty — see the header. */
const LEFT_EMPTY: ReadonlySet<string> = new Set(["startdate"]);

/** Part 1's facts about one applicant, as recruiting reads them. */
export interface MedstopApplicantFacts {
  invitationId: string;
  driverId: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  birthDate: string | null;
  gender: DonorGender | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** `+1XXXXXXXXXX`, as 0376 stores it. */
  phone: string | null;
  licenceNumber: string | null;
  licenceState: string | null;
  licenceExpiresOn: string | null;
  cdlClass: string | null;
}

/**
 * Why an applicant is NOT created in Med-Stop, in the office's words — or null to go ahead. The step
 * shows it, so the office knows to add the person by hand.
 */
export function medstopApplicantSkip(f: MedstopApplicantFacts): string | null {
  if (f.gender === "declined") return "They chose not to give a gender, so add them in Med-Stop yourself.";
  if (f.gender === null) return "Part 1 did not ask their gender (it started before the question existed), so add them in Med-Stop yourself.";
  if (f.licenceState && !US_JURISDICTION_CODES.has(f.licenceState.toUpperCase()))
    return "Their licence is not from a US state, so add them in Med-Stop yourself.";
  return null;
}

/** `+13125550100` → `(312) 555-0100`, the shape Med-Stop's own records carry. */
export function medstopPhone(e164: string | null): string | null {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : null;
}

/** `YYYY-MM-DD` → the form's own `YYYY-MM-DDT00:00:00Z`. */
export function medstopDate(day: string | null): string | null {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00Z` : null;
}

const text = (v: string | null | undefined): string => (v ?? "").trim();

/**
 * Med-Stop's blank form with ours filled in — or the required keys still empty, in which case nothing
 * may be sent. Every key of `form` is kept; no key is added that the form did not have.
 */
export function fillMedstopApplicantForm(
  form: Readonly<Record<string, unknown>>,
  f: MedstopApplicantFacts,
): { form: Record<string, unknown> } | { missing: string[] } {
  const ours: Record<string, unknown> = {
    fname: text(f.firstName),
    mname: text(f.middleName),
    lname: text(f.lastName),
    birthdate: medstopDate(f.birthDate),
    gender: f.gender === "male" || f.gender === "female" ? f.gender.toUpperCase() : "",
    status: "APPLICANT",
    category: "DRIVER",
    drivingtype: "NON-EXCEPTED INTERSTATE",
    idclass: "CDL",
    startdate: null,
    address: text(f.addressLine1),
    address1: text(f.addressLine2),
    city: text(f.city),
    state: text(f.state).toUpperCase(),
    zip: text(f.postalCode),
    phone1: medstopPhone(f.phone) ?? "",
    license: text(f.licenceNumber),
    licensestate: text(f.licenceState).toUpperCase(),
    licenseclass: text(f.cdlClass).toUpperCase(),
    licenseexpiration: medstopDate(f.licenceExpiresOn),
    idnumber: text(f.licenceNumber),
  };
  const out: Record<string, unknown> = { ...form };
  for (const [key, value] of Object.entries(ours)) if (key in form) out[key] = value;
  const missing = MEDSTOP_APPLICANT_REQUIRED.filter(
    (k) => !LEFT_EMPTY.has(k) && (!(k in form) || out[k] === null || out[k] === undefined || out[k] === ""),
  );
  return missing.length > 0 ? { missing } : { form: out };
}

/** What became of one applicant's create — the step's line (`medstop_applicant_creates`, 0470). */
export type MedstopApplicantCreateOutcome = "created" | "refused" | "unknown";
export interface MedstopApplicantCreateView {
  outcome: MedstopApplicantCreateOutcome;
  /** Med-Stop's own sentence for a refusal; null otherwise. */
  message: string | null;
  at: string;
}
