import type { EquipmentClass } from "@silvicom/shared";

// ⚠ Split out of `draft.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1), at the 450-line
// warning: this module is the form's working SHAPE and its empty values; `draft.ts` keeps the three
// mappings across the boundary (`toApplication`, `toDraftPayload`, `fromDraftPayload`) and re-exports
// everything here, so every `import … from "@/features/apply/draft"` still resolves.

/**
 * The form's own working shape (H5b).
 *
 * A form holds half-typed strings; `DriverApplication` holds a certified document. Binding inputs
 * straight to the contract type would mean either lying to TypeScript about a `date_of_birth` that
 * is currently `"198"`, or defaulting fields to values the applicant never entered — and a default
 * on THIS form is a fact asserted on somebody's behalf about their own driving history.
 *
 * So the draft is all-strings-and-arrays, and `toApplication` hands the whole thing to
 * `driverApplicationSchema` at submit time. One validator, the server's own, and no second opinion
 * in the client about what §391.21 requires.
 */

export interface DraftAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal_code: string;
  from: string;
  to: string;
}

export interface DraftEmployer {
  employer_name: string;
  usdot_number: string;
  address_line1: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  position_held: string;
  started_on: string;
  ended_on: string;
  operated_cmv: boolean;
  dot_regulated: boolean;
  reason_for_leaving: string;
  subject_to_fmcsr: boolean;
  safety_sensitive: boolean;
}

export interface DraftAccident {
  occurred_on: string;
  nature: string;
  fatalities: string;
  injuries: string;
  hazmat_spill: boolean;
}

export interface DraftViolation {
  occurred_on: string;
  offence: string;
  /**
   * ⚠ Named `location` until 2026-08-21, which meant it went NOWHERE.
   *
   * `applicationViolationSchema` has always defined `state`, `toApplication` has always emitted
   * `location`, and the nested schema was not `.strict()` — so zod dropped the key without a word and
   * every traffic conviction declared since H5b was filed with no place attached. A3 made the nested
   * schemas strict, which turned the silent drop into a validation error, which is how it was found.
   * The inverse of 2026-08-20's lesson, and the same shape: when a field exists on one side of a
   * boundary and not the other, somebody's answer falls through the gap.
   */
  state: string;
  penalty: string;
}

/** §391.21(b)(6) — one class of equipment the applicant has operated, and for how long. */
export interface DraftEquipment {
  equipment_class: EquipmentClass | "";
  equipment_type: string;
  from: string;
  to: string;
  approx_miles: string;
}

/** §391.21(b)(5) — one of the other unexpired licences or permits the applicant holds. */
export interface DraftLicence {
  issuing_authority: string;
  number: string;
  expires_at: string;
  kind: string;
}

export interface ApplicationDraft {
  first_name: string;
  middle_name: string;
  last_name: string;
  /** §391.23(a)(2) — the names a previous employer would know them by. Not a (b)(2) field. */
  other_names: string[];
  date_of_birth: string;
  email: string;
  phone: string;
  addresses: DraftAddress[];
  cdl_number: string;
  cdl_state: string;
  cdl_class: string;
  cdl_expires_at: string;
  experience: string;
  equipment_experience: DraftEquipment[];
  accidents: DraftAccident[];
  declares_no_accidents: boolean;
  violations: DraftViolation[];
  declares_no_violations: boolean;
  licence_ever_denied: boolean;
  licence_denial_detail: string;
  /** §40.25(j)'s two-year question (P8). Boolean in the draft — the contract's null means "the form
   *  never asked", which is true of payloads filed before P8 and false of every draft this creates. */
  prior_failed_pre_employment_test: boolean;
  employers: DraftEmployer[];
  declares_no_employment: boolean;
  certified: boolean;
  signed_name: string;
  additional_licences: DraftLicence[];
  /**
   * The carrier's own questions (A9, D-APP12).
   *
   * A loose record rather than a typed shape, and deliberately: the questions are DATA — a versioned
   * definition in shared — so a typed draft field per question would put the carrier's form back in
   * the code that D-APP12 exists to keep it out of. Scalars are strings or booleans; a `table`
   * question's answer is an array of row records.
   */
  questionnaire: Record<string, unknown>;
  /**
   * §391.21(b)(2)'s Social Security number — the one field that is NOT part of the application
   * payload and NOT autosaved (D-APP3).
   *
   * It travels beside the application in `applicationSubmitSchema` and straight into `sealSsn`, and
   * `toDraftPayload` does not carry it: `application_drafts` is prunable, plain jsonb, and nine
   * digits do not go in it. It is on the draft type because the form has to hold it while the driver
   * types, and nowhere else.
   */
  ssn: string;
}

export const emptyAddress = (): DraftAddress => ({
  line1: "", line2: "", city: "", state: "", postal_code: "", from: "", to: "",
});

export const emptyEmployer = (): DraftEmployer => ({
  employer_name: "", usdot_number: "", address_line1: "", city: "", state: "", phone: "", email: "",
  position_held: "", started_on: "", ended_on: "",
  // Both default TRUE because the applicant is being asked about driving jobs, and the cost of the
  // two defaults is asymmetric: a warehouse job wrongly marked DOT-regulated produces an inquiry
  // nobody owed, while a driving job wrongly marked otherwise silently drops a §391.23(a)(2)
  // obligation the carrier is required to discharge.
  operated_cmv: true, dot_regulated: true,
  reason_for_leaving: "", subject_to_fmcsr: false, safety_sensitive: false,
});

export const emptyAccident = (): DraftAccident => ({
  occurred_on: "", nature: "", fatalities: "0", injuries: "0", hazmat_spill: false,
});

export const emptyViolation = (): DraftViolation => ({
  occurred_on: "", offence: "", state: "", penalty: "",
});

export const emptyEquipment = (): DraftEquipment => ({
  equipment_class: "", equipment_type: "", from: "", to: "", approx_miles: "",
});

export const emptyLicence = (): DraftLicence => ({
  issuing_authority: "", number: "", expires_at: "", kind: "",
});

export const emptyDraft = (): ApplicationDraft => ({
  first_name: "", middle_name: "", last_name: "", other_names: [], date_of_birth: "", email: "", phone: "",
  addresses: [emptyAddress()],
  cdl_number: "", cdl_state: "", cdl_class: "", cdl_expires_at: "",
  experience: "",
  // Empty, like `additional_licences`: a pre-added blank row invites an invented answer, and
  // §391.21(b)(6) is satisfied by the narrative alone for a driver who would rather write one.
  equipment_experience: [],
  accidents: [], declares_no_accidents: false,
  violations: [], declares_no_violations: false,
  licence_ever_denied: false, licence_denial_detail: "",
  prior_failed_pre_employment_test: false,
  employers: [emptyEmployer()], declares_no_employment: false,
  certified: false, signed_name: "",
  // Empty by default: §383.21 forbids a CMV driver holding more than one licence, so the normal
  // answer to "any others?" is none, and a pre-added blank row would invite an invented one.
  additional_licences: [],
  questionnaire: {},
  ssn: "",
});
