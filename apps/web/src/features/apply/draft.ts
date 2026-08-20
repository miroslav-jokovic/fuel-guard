import type { DriverApplication } from "@fuelguard/shared";

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
  location: string;
  penalty: string;
}

export interface ApplicationDraft {
  first_name: string;
  middle_name: string;
  last_name: string;
  date_of_birth: string;
  email: string;
  phone: string;
  addresses: DraftAddress[];
  cdl_number: string;
  cdl_state: string;
  cdl_class: string;
  cdl_expires_at: string;
  experience: string;
  accidents: DraftAccident[];
  declares_no_accidents: boolean;
  violations: DraftViolation[];
  declares_no_violations: boolean;
  licence_ever_denied: boolean;
  licence_denial_detail: string;
  employers: DraftEmployer[];
  declares_no_employment: boolean;
  certified: boolean;
  signed_name: string;
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
  occurred_on: "", offence: "", location: "", penalty: "",
});

export const emptyDraft = (): ApplicationDraft => ({
  first_name: "", middle_name: "", last_name: "", date_of_birth: "", email: "", phone: "",
  addresses: [emptyAddress()],
  cdl_number: "", cdl_state: "", cdl_class: "", cdl_expires_at: "",
  experience: "",
  accidents: [], declares_no_accidents: false,
  violations: [], declares_no_violations: false,
  licence_ever_denied: false, licence_denial_detail: "",
  employers: [emptyEmployer()], declares_no_employment: false,
  certified: false, signed_name: "",
});

const text = (v: string): string | null => (v.trim() === "" ? null : v.trim());
const num = (v: string): number => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Draft → the shape the contract validates.
 *
 * Empty strings become `null`, never `""`: the schema's `.nullish()` fields mean "not answered", and
 * an empty string is an answer of nothing. Rows the applicant added and left completely blank are
 * dropped — an accidental "Add another" click is not a declaration.
 */
export function toApplication(draft: ApplicationDraft): unknown {
  return {
    first_name: draft.first_name.trim(),
    middle_name: text(draft.middle_name),
    last_name: draft.last_name.trim(),
    date_of_birth: draft.date_of_birth,
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    addresses: draft.addresses
      .filter((a) => a.line1.trim() || a.city.trim())
      .map((a) => ({
        line1: a.line1.trim(), line2: text(a.line2), city: a.city.trim(),
        state: a.state.trim(), postal_code: a.postal_code.trim(),
        from: a.from, to: text(a.to),
      })),
    cdl_number: draft.cdl_number.trim(),
    cdl_state: draft.cdl_state.trim().toUpperCase(),
    cdl_class: text(draft.cdl_class),
    cdl_expires_at: draft.cdl_expires_at,
    experience: text(draft.experience),
    accidents: draft.accidents
      .filter((a) => a.occurred_on || a.nature.trim())
      .map((a) => ({
        occurred_on: a.occurred_on, nature: a.nature.trim(),
        fatalities: num(a.fatalities), injuries: num(a.injuries), hazmat_spill: a.hazmat_spill,
      })),
    declares_no_accidents: draft.declares_no_accidents,
    violations: draft.violations
      .filter((v) => v.occurred_on || v.offence.trim())
      .map((v) => ({
        occurred_on: v.occurred_on, offence: v.offence.trim(),
        location: text(v.location), penalty: text(v.penalty),
      })),
    declares_no_violations: draft.declares_no_violations,
    licence_ever_denied: draft.licence_ever_denied,
    licence_denial_detail: text(draft.licence_denial_detail),
    employers: draft.employers
      .filter((e) => e.employer_name.trim())
      .map((e) => ({
        employer_name: e.employer_name.trim(),
        usdot_number: text(e.usdot_number),
        address_line1: text(e.address_line1),
        city: text(e.city),
        state: text(e.state),
        phone: text(e.phone),
        email: text(e.email),
        position_held: text(e.position_held),
        started_on: e.started_on,
        ended_on: text(e.ended_on),
        operated_cmv: e.operated_cmv,
        dot_regulated: e.dot_regulated,
        reason_for_leaving: text(e.reason_for_leaving),
        subject_to_fmcsr: e.subject_to_fmcsr,
        safety_sensitive: e.safety_sensitive,
      })),
    declares_no_employment: draft.declares_no_employment,
    certified: draft.certified,
    signed_name: draft.signed_name.trim(),
  } satisfies Record<keyof DriverApplication | string, unknown>;
}
