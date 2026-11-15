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
