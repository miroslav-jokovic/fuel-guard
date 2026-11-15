/**
 * The Part 1 row every invitation has had since C3a (`mintIntakeRow`), with nothing answered yet. It is
 * what makes a link a CURRENT one: the bundle, the permissions and the filing all read "has a row".
 *
 * ── WHY IT IS SHARED (APPLICATION-FIX-PLAN §7, 1b-5 step 4) ───────────────────────────────────
 * An invitation with no `application_intakes` row is a LEGACY one, from before Part 1. Its form is
 * retired and no driver is sent one, so a test that seeds an invitation without this row is testing a
 * link that does not exist. Every fixture that stands for "the link a driver is sent" seeds this, from
 * one definition, so the day the resolver refuses a legacy invitation on every route there is one place
 * that says what a current link is.
 *
 * ⚠ Every answer column is here, as null, the way `mintIntakeRow`'s bare insert leaves the row. A reader
 * handed a row with a column MISSING meets `undefined`, which no real row can give it: the reading copy
 * crashed on exactly that the first time this was seeded with five keys.
 */
export const PART_ONE_ROW = {
  phone: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  prior_positive_2y: null,
  dot_program_30d: null,
  dot_tested_6m: null,
  dot_random_12m: null,
  fcra_summary_version: null,
  fcra_summary_shown_at: null,
  medical_card_pending: false,
  cdl_photo_pending: false,
  endorsements: null,
  donor_gender: null,
  selfie_verdict: null,
};

/**
 * Part 1 ANSWERED, as the tables a filing reads: the row with its phone, home and §40.25(j) answer, and
 * the one licence. A current link files the certified application with these laid over it
 * (`composeFiledApplication`), and is refused without them — so a test that files on a current link
 * seeds these in place of the empty row above.
 */
export const PART_ONE_ANSWERED = {
  application_intakes: [{
    ...PART_ONE_ROW,
    phone: "+13125550142",
    address_line1: "1 Main St",
    city: "Joliet",
    state: "IL",
    postal_code: "60431",
    prior_positive_2y: false,
  }],
  application_intake_licences: [
    { position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" },
  ],
};

/** An employer answering every (b)(10) question, covering the whole three-year window. */
export const CURRENT_LINK_EMPLOYER = {
  key: "5b0c6a4e-1f2d-4c3b-9a8e-7d6c5b4a3f21", employer_name: "Midwest Freight",
  address_line1: "1 Main St", city: "Joliet", state: "IL",
  started_on: "2020-01-01", ended_on: null, operated_cmv: true, dot_regulated: true,
  reason_for_leaving: "Still employed", subject_to_fmcsr: true, safety_sensitive: true,
};

/**
 * The certified application a current link can FILE once `PART_ONE_ANSWERED` is laid over it: three
 * years of home and of work, a clean record, page 21, and the carrier's required questions (v3's seven).
 *
 * ⚠ What it types for the home and the licence is deliberately NOT Part 1's ("typed", "TYPED1"): Part 1
 * wins on a current link, and a test that reads the filed payload can tell which one was filed.
 */
export const CURRENT_LINK_APPLICATION = {
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "typed", line2: null, city: "typed", state: "WI", postal_code: "53201", from: "2019-02", to: null }],
  cdl_number: "TYPED1", cdl_state: "WI", cdl_expires_at: "2027-01-01",
  additional_licences: [], experience: "Eight years, dry van.",
  accidents: [], declares_no_accidents: true, violations: [], declares_no_violations: true,
  licence_ever_denied: false, licence_suspended: false, prior_failed_pre_employment_test: null,
  // Q-AM4: page 21, answered (all zeros is an answer).
  seven_day_hours: [0, 0, 0, 0, 0, 0, 0], last_relieved_at: "2026-08-20T17:00",
  employers: [CURRENT_LINK_EMPLOYER], declares_no_employment: false, employment_gaps: [],
  // §9 P8 / §11: a certified document answers the carrier's required questions (v3's seven).
  questionnaire_version: "silvicom_driver@v3",
  questionnaire_answers: {
    position: "Company driver", applying_as: "company_driver", heard_from: "A friend", legally_work: true,
    proof_of_age: true, may_contact_employers: true, education: [{ school: "Joliet High" }],
  },
  certified: true as const, signed_name: "Susan Godfrey",
};
