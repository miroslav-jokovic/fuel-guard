/**
 * Every word the carrier's packet prints on the pages we fill (P4, D-PKT1).
 *
 * ── WHY THE TEXT IS A TABLE AND NOT INLINE IN THE RENDERER ────────────────────────────────────
 * Two reasons, and the second is the one that matters. The first is the ordinary one: this is the
 * carrier's wording, it will be reviewed by somebody who is not an engineer, and a reviewer should be
 * able to read it without reading PDFKit calls.
 *
 * The second is `CORRECTIONS` below. The packet's own text is corrupt — "Previous Three years
 * reisdency", "BACKFROUNG VERIFICATION LOG", "maritial status" — and the owner's decision
 * (Q-PKT4, 2026-08-23, D-PKT9) is to print correct English. **A correction made silently is a
 * correction nobody can audit**, so every one of them is recorded here as a pair, the renderer draws
 * only the corrected side, and a test asserts that no original ever reaches the page. If the carrier
 * later asks "what did you change on our form", the answer is this constant.
 *
 * ⚠ **Spelling only. Not one question, instruction or legal sentence is reworded.** The distinction
 * is enforced by the shape of the data: a correction is a pair whose two halves differ ONLY in
 * spelling and capitalisation, and `renderPacket.test.ts` refuses a pair that changes word count.
 * Changing what the form ASKS is D-PKT4's other half and belongs to counsel, not to a copy pass.
 */

/** One repaired string, with the packet's own version kept beside it. */
export interface PacketCorrection {
  /** Exactly as the workbook has it. Never printed. */
  packet: string;
  /** What we print instead. */
  corrected: string;
  /** Which page it appears on, so a reviewer can find it on their paper copy. */
  page: number;
}

/**
 * The register. ⚠ Every entry is a SPELLING repair — see the header.
 *
 * Sourced by parsing `docs/plans/recruitment/APPLICATION.xlsx` (sheet1 against sharedStrings) rather
 * than by reading a summary of it, so the left column is the literal cell value.
 */
export const CORRECTIONS: readonly PacketCorrection[] = [
  { page: 1, packet: "Previous Three years reisdency", corrected: "Previous three years residency" },
  { page: 1, packet: "maritial status", corrected: "marital status" },
  { page: 2, packet: "FORFEITTURES", corrected: "FORFEITURES" },
  { page: 12, packet: "BACKFROUNG", corrected: "BACKGROUND" },
  { page: 16, packet: "benfit", corrected: "benefit" },
  { page: 16, packet: "This references should not be people", corrected: "These references should not be people" },
  { page: 26, packet: "administrated by an", corrected: "administered by an" },

  // ── The static policy pages (P3). The AGREEMENT (29–30) is deliberately absent — see below.
  { page: 7, packet: "IMPOREPER", corrected: "IMPROPER" },
  { page: 7, packet: "OVERWIGHT", corrected: "OVERWEIGHT" },
  { page: 8, packet: "YOU WIL INSPECT", corrected: "YOU WILL INSPECT" },
  { page: 8, packet: "SAME CONDTION", corrected: "SAME CONDITION" },
  { page: 8, packet: "WHEN RECIVED", corrected: "WHEN RECEIVED" },
  { page: 8, packet: "TEAR EXEPTED", corrected: "TEAR EXCEPTED" },
  { page: 8, packet: "EQUIPMENT MANGER", corrected: "EQUIPMENT MANAGER" },
];

/**
 * ⚠ **Six page-24 entries were removed on 2026-08-23 (Q-PKT5) and must not come back.**
 *
 * `familirize`, `requred`, `followign`, `informend`, `expalined` and `signatrure` were registered
 * when page 24 was classified STATIC. It is not: it is a post-hire training record carrying a driver
 * signature, an instructor signature and a fill-in date, and it left the packet with the same
 * argument that moved pages 21 and 23 out. The page is `DRIVER-TRAINING-PLAN.md` / R7's now, and its
 * spelling is that plan's problem on the day it renders the page — registering a correction here for
 * a page this renderer never draws would be a constant nobody could check against anything.
 *
 * ⚠ **`signatrure` in particular.** It is also on pages 22 and 23, neither of which we render, and
 * it is why the packet's placement inventory cannot be re-derived by searching for `signature`
 * (Q-PKT6). Deleting the correction does not delete the fact; the fact lives in the plan.
 */

/**
 * ⚠ **Corruption that is NOT corrected, because the right word is a guess.**
 *
 * Recorded rather than silently skipped, so the next reader knows these were seen and left.
 *
 * ⚠ Every entry this list held was on page 24 — `available throught to company`, `a question-and-
 * answer period which eluded additional company illustrations` (included? alluded to?),
 * `company fues` (fines? fees?), `FMCR Handbook` (almost certainly FMCSR, but expanding an acronym
 * is not spelling), `I may come to the company und get further explanation`. They travelled with the
 * page to R7 on 2026-08-23 (Q-PKT5) and the plan carries them now. **The list is kept, empty, because
 * the rule it states outlives its entries:** a repair that guesses is a wording change, and D-PKT4
 * puts wording with counsel. The next page that needs one has somewhere to put it.
 */

/**
 * Apply the register to one line of the packet's own text.
 *
 * ⚠ Used for the STATIC pages only, and never for pages 29–30. `packetStatic.ts` stores the workbook's
 * text pristine so a test can compare it against the source; the corrections are applied on the way to
 * the page instead of being baked in. The fillable pages in this file work the other way round —
 * short labels, assembled by hand, already correct — and the difference is explained there.
 */
export function correct(source: string): string {
  let out = source;
  for (const c of CORRECTIONS) out = out.split(c.packet).join(c.corrected);
  return out;
}

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
  residency: "Previous three years residency",
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
