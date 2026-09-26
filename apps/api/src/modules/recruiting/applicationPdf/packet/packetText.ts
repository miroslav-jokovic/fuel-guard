/**
 * Every word the carrier's packet prints on the pages we fill (P4, D-PKT1).
 *
 * ── WHY THE TEXT IS A TABLE AND NOT INLINE IN THE RENDERER ────────────────────────────────────
 * Two reasons, and the second is the one that matters. The first is the ordinary one: this is the
 * carrier's wording, it will be reviewed by somebody who is not an engineer, and a reviewer should be
 * able to read it without reading PDFKit calls.
 *
 * The second is the packet's spelling. The carrier's text carries typing errors — "Previous Three
 * years reisdency", "BACKFROUNG VERIFICATION LOG", "maritial status" — and since **D-PKT20 (owner,
 * 2026-09-25)** they are corrected: *"my secretary retyped this application so lets fix spelling
 * mistakes"*. The strings here are the CORRECTED text, because they are what the continuation sheet
 * quotes as the carrier's heading and it must read what the page above it prints. The one list of
 * corrections is `packetSpelling.ts`; `packetSpelling.test.ts` fails if any string here still holds
 * one of its misspellings.
 *
 * ⚠ This reverses D-PKT11 (2026-09-14, *"use texts … as is — these are created by lawyers"*), which
 * had itself reversed D-PKT9. What changed is the provenance: a typing error in a retyped document
 * is the typist's, not counsel's. The history is in `APPLICATION-PACKET-PLAN.md` §3.9.
 *
 * ⚠ **One class of defect is still NOT reproduced, and it is not spelling.** The carrier's Numbers
 * export drops `fi`/`ti`/`ffi` ligatures — it writes "quali ed applicants", "certi ed copy",
 * "remain on le", "no ca on". Measured 2026-09-14: ~65 distinct broken fragments in that export and
 * **zero** in the same document printed from Excel. Those words are not in the carrier's document;
 * they are damage done on the way out of Numbers. Transcribing them would put a defect INTO an
 * instrument, which is the opposite of what "as is" asks for. The Excel print is therefore the text
 * authority, and the Numbers export is consulted only for content. */

/**
 * ⚠ **What is deliberately NOT corrected, and why the list is shorter than the packet's defects.**
 *
 * The packet also reads `APPROX.NO. OF MILES` (missing space), `( OTHER THAN PARKING VIOLATION)`
 * (space after the bracket, and a singular where a plural reads better), and `ETC )`. Every one of
 * those is a SPACING or PUNCTUATION repair, and they are left exactly as the carrier has them.
 *
 * The reason is the guard rather than timidity. `renderPacket.test.ts`'s "are spelling repairs only —
 * no correction changes the number of words" requires the two halves to have the same word count,
 * which is the one cheap
 * check that catches a dropped clause or an inserted qualifier. A re-spacing repair changes that
 * count (`APPROX.NO.` is one word, `APPROX. NO.` is two), so allowing them would mean loosening the
 * guard until it could no longer tell a joined word from a deleted one. A misspelled WORD is
 * unambiguous and safe to repair; the carrier's spacing is their own. `VIOLATION` → `VIOLATIONS`
 * is excluded on the same principle from the other side: pluralising is a wording change wearing a
 * spelling change's clothes, and D-PKT4 puts wording with counsel.
 */

/** Page 1 — Commercial driver information. */
export const P1 = {
  heading: "Commercial driver information",
  intro:
    "This transportation company is in compliance with all federal and state laws. Consideration of "
    + "qualified applicants is made without regard to applicant's sex, race, color, national origin, "
    + "marital status, age, religion or non-job related disability.",
  date: "Date",
  dob: "DOB",
  position: "Position",
  ssn: "Social Security number",
  name: "Name",
  nameParts: "Last                First                Middle",
  address: "Address",
  addressParts: "Street                City                State                Zip",
  residency: "Previous Three years residency",
  cdl: "Cdl #",
  phone: "Phone #",
  legallyWork: "Can you legally work in USA?",
  proofOfAge: "Do you have proof of age?",
  contactEmployers: "May we contact your previous employers?",
  heardFrom: "How did you hear about this company?",
} as const;

/** Page 2 — licences, driving experience, accidents, convictions, licence history. */
export const P2 = {
  oneLicence:
    'Section 383.21 FMCSR states "No person who operates a commercial motor vehicle shall at any '
    + 'time have more than one driver\'s license"',
  licenceColumns: ["STATE", "LICENSE NO.", "TYPE", "EXPIRATION DATE"],
  experienceHeading: "DRIVING EXPERIENCE",
  experienceColumns: [
    "CLASS OF EQUIPMENT",
    "TYPE OF EQUIPMENT (VAN, TANK, FLAT, ETC )",
    "DATES FROM / TO",
    "APPROX.NO. OF MILES (TOTAL)",
  ],
  /**
   * ⚠ The packet's four printed rows, in its own order and its own words. `EQUIPMENT_CLASSES` has
   * six values; the mapping and why it is not information loss are in the plan's §3.1 and in
   * `renderPacket.ts`'s `packetEquipmentRow`.
   */
  experienceRows: ["STRAIGHT TRUCK", "TRACTOR - SEMI TRAILER", "TRACTOR - TWO TRAILERS", "OTHER"],
  accidentsHeading: "ACCIDENT RECORD FOR PAST 3 YEARS",
  accidentColumns: [
    "DATES",
    "NATURE OF ACCIDENT (HEAD-ON, REAR-END, ROLLOVER, ETC.)",
    "FATALITIES NUMBER",
    "INJURIES NUMBER",
    "CHEMICAL SPILLS YES OR NO",
  ],
  violationsHeading: "TRAFFIC CONVICTIONS AND FORFEITURES FOR THE PAST 3 YEARS ( OTHER THAN PARKING VIOLATION)",
  violationColumns: ["DATE CONVICTED", "VIOLATION", "STATE OF VIOLATION", "PENALTY"],
  deniedQuestion: "A. Have you ever been denied a license, permit or privilege to operate a motor vehicle?",
  revokedQuestion: "B. Has any license, permit or privilege ever been suspended or revoked?",
  explain: "If yes, explain",
} as const;

/** Page 12 — the ten-year background verification log. */
export const P12 = {
  heading: "10 YEAR EMPLOYMENT HISTORY BACKGROUND VERIFICATION LOG",
  identityColumns: ["Last name", "First name", "Aliases", "DOB", "SS #"],
  logColumns: ["Date from / to", "Company name", "Address", "Position held", "Phone #"],
} as const;

/** Page 16 — education, military, other training, references. */
export const P16 = {
  heading: "Education and Training",
  intro: "Please provide the following information about completed education, starting with the most recent.",
  educationColumns: ["School or University", "Years completed", "Field of Study", "Graduated?", "When?"],
  military: "Have you ever served in the military?",
  militaryWhen: "If so, when?",
  training:
    "Please list any training you have received that will benefit you for the position for which you "
    + "are applying",
  referencesIntro:
    "Please provide 3 personal references. These references should not be people related to you nor "
    + "former supervisors:",
  referenceColumns: ["Full name", "Years known", "Phone number"],
} as const;

/**
 * Page 26 — the §40.25(j) two-year question.
 *
 * ⚠ Not rendered until P8 (2026-08-23), because the plan's inventory said the data was already
 * collected and it was not: the wizard held `safety_sensitive` and `subject_to_fmcsr`, two
 * PER-EMPLOYER booleans about a job the driver actually HELD, which is a different question from "a
 * job you applied for and did not get". P8 added `prior_failed_pre_employment_test` to the contract
 * and a control to the driving-record screen; this page draws it now.
 */
export const P26 = {
  nameLabel: "Driver's / Owner's Name",
  question:
    "Did you test positive or refuse a test on any pre-employment drug or alcohol test administered "
    + "by an employer to which you applied for, but did not obtain, safety-sensitive transportation "
    + "work covered by DOT agency drug and alcohol testing rules during the past two years?",
  check: "Check appropriate box below.",
  yes: "YES",
  no: "NO",
  signature: "Driver / Owner Signature",
  /** Printed instead of a marked box when the payload predates P8 — see `page26`. */
  notAsked: "This application was submitted before this question was added to the form.",
} as const;

/**
 * The two lines every page of the packet carries, and the reason they are NOT per-org.
 *
 * They are statements about what the document IS — a §391.51 file record rather than a hiring
 * decision — not about who issued it. The letterhead above them is the carrier's and comes from
 * `organizations` (D-PKT8); these two are the packet's own and are reproduced verbatim on all 31
 * pages, including the ones we do not render.
 */
export const FOOTER = {
  purpose: "FOR DEPARTMENT OF TRANSPORTATION VERIFICATION PURPOSE ONLY",
  notAnApplication: "THIS IS NOT AN EMPLOYMENT APPLICATION",
} as const;

/**
 * What the packet prints when a table has more rows than it has lines — the packet's own answer,
 * lifted from page 11's heading.
 *
 * ⚠ This is not a nicety. §391.21(b)(7)–(9) asks for ALL accidents and convictions in the period,
 * and every table on these pages has three printed lines. Silently dropping the fourth would produce
 * a document that is signed, filed, and materially false.
 */
export const CONTINUED = "ATTACH SHEET IF MORE SPACE IS NEEDED — see continuation";
