/**
 * D-HM9's fourteen steps — the owner's hiring process, written down exactly once.
 *
 * ⚠ **Split out of `hiringChecklist.ts` at the 450-line warning**, and along a real seam rather than
 * wherever the line count fell: this file is the RULED PROCESS — which steps exist, in what order,
 * which ones federal law fixes, and what row proves each — and its neighbour is the computation that
 * folds evidence over it. `app.ts`'s header makes the argument for splitting at the warning and not
 * at the wall: squeezing back under by deleting a comment leaves the next person at the same wall
 * with no headroom, and the next person here is whoever builds the three steps that have no evidence
 * table yet.
 *
 * ── THE ORDER IS LAW, NOT A PREFERENCE (D-HM3) ────────────────────────────────────────────────
 * §5 verified the six federal gates against FMCSA and eCFR in September 2026. A configurable
 * pipeline that let a carrier put the road test before the drug test would be a product that helps
 * somebody commit a violation, so the six are not movable. Carrier-specific steps — the handbook,
 * the live orientation day, issuing equipment — are insertable anywhere.
 *
 * ── AND THE SEAM THE WHOLE THING TURNS ON IS TRAVEL (D-HM9, owner 2026-09-17) ─────────────────
 * *"these are done before applicant even come to office, road test is when he comes to office."*
 * Steps 1–9 happen before the applicant gets on a plane; 10–14 happen while they stand in the
 * office. `beforeTravel` is that seam, and `readyToTravel` is that predicate over this array.
 */

export type HiringStepKey =
  | "invitation_sent"
  | "permissions_signed"
  | "application_filled"
  | "office_approved"
  | "mvr"
  | "psp"
  | "clearinghouse"
  | "drug_test"
  | "medical_certificate"
  | "orientation_videos"
  | "road_test"
  | "live_orientation"
  | "handbook"
  | "application_signed"
  | "hired";

/** Where the step physically happens. The seam that D-HM9 organises everything around. */
export type HiringStepWhere = "remote" | "office" | "external";

/**
 * The coarse word a recruiter uses for "where is this one" — the board's Stage column (B4, §4.1).
 *
 * ── WHY A FIELD HERE AND NOT A MAP BESIDE THE BOARD ───────────────────────────────────────────
 * The board needs a five-word answer next to a fifteen-step one, and there were two ways to get it:
 * group the steps here, or write a `Record<HiringStepKey, string>` in the page. The second is a copy
 * of this array with a delay fuse — every step added below would need a line added there, nothing
 * would fail if it were forgotten, and the board would quietly show a blank stage for the newest
 * step in the process. `CLAUDE.md`'s *deriving beats restating* is the rule, and this is what
 * obeying it looks like: the phase is a property OF the step, so a step cannot exist without one.
 *
 * ⚠ It is NOT `where`, though they look similar. `where` is physical (which building the act happens
 * in) and answers logistics; `phase` is what the recruiter calls that part of the hire. The road
 * test and the handbook are both `office` and are different phases; the orientation videos are
 * `remote` and share a phase with the live day that is not.
 *
 * ⚠ And it is NOT `applicantPipeline.ts`'s `ApplicantStage`, which is the older seven-stage answer
 * built before any of this existed. That one is still derived, still correct about what it measures
 * — the §391.21(b)(10) history and the releases — and it stops where the application does. This
 * goes to the hire. Two live answers to "what stage" would be exactly the disagreement D-HM2 was
 * written against, so the board reads THIS one and the older stage no longer has a column.
 */
export type HiringPhase = "application" | "screening" | "orientation" | "office_day" | "hire";

/**
 * ⚠ "Ready to hire" rather than "Hired": the phase names what is OUTSTANDING, because the board
 * shows the phase of the step a driver is waiting on, never of the last one they finished.
 */
export const HIRING_PHASE_LABELS: Record<HiringPhase, string> = {
  application: "Application",
  screening: "Screening",
  orientation: "Orientation",
  office_day: "Office day",
  hire: "Ready to hire",
};

export interface HiringStepSpec {
  key: HiringStepKey;
  /**
   * D-HM9's own number, as a STRING — because one of them is `8b`.
   *
   * ⚠ The medical certificate was inserted after the phrase "the fourteen steps" had been coined, so
   * the list is fourteen by name and fifteen by count. Renumbering would break every reference in
   * the plan to a step by its number; `HIRING_STEPS.length` is the count, and nothing restates it.
   */
  ordinal: string;
  /** Plain words, the first of D-HUI3's three columns. Never a regulation — that goes in the drawer. */
  label: string;
  where: HiringStepWhere;
  /**
   * The same step as an INSTRUCTION — the board's "Next action" column (§4.1, B4).
   *
   * ⚠ A second string for one step looks like duplication and is not. `label` names the step as a
   * THING, which is what a checklist row is ("Office approved it", "Permissions signed"), and the
   * board asks this catalogue for something else entirely: what has to happen next. Rendering
   * `label` in that column produced *"Next action: Office approved it"* — a completed fact where an
   * instruction belongs, so the row read as though it were already done. Found by looking at the
   * board at 1440 on 2026-09-18; every test passed at the time and none of them could have seen it.
   *
   * ⚠ It says what must HAPPEN, not what the reader must do, because the Waiting-on column beside it
   * already says who. *"Finish the orientation videos · Them"* is right; *"Chase the videos"* would
   * put the office's verb on the applicant's step and be wrong in the other direction.
   */
  action: string;
  /** The board's Stage column, in one word. See `HiringPhase` for why it is not `where`. */
  phase: HiringPhase;
  /**
   * One of the six things §5 says a carrier must hold before the driver first drives.
   *
   * ⚠ Not reorderable and not skippable (D-HM3, Q-HM5 ruled REFUSE): a configurable pipeline that
   * let a carrier put the road test before the drug test would be a product that helps somebody
   * commit a violation.
   */
  federalGate: boolean;
  /** Steps 1–9. `readyToTravel` is exactly this predicate over the catalogue. */
  beforeTravel: boolean;
  /** Who moves next when the step has not started. PSP is the one that also has an in-flight state. */
  owes: "us" | "them";
  /**
   * What must be done first, and every edge here is law or a database constraint — never a
   * preference. The office may act out of order on anything not listed (D-HUI7).
   */
  requires: readonly HiringStepKey[];
  /**
   * The row that proves it, or `null` when nothing in the schema can.
   *
   * ⚠ `null` is what keeps a step out of the fold. Three of them are `null` today and each one is a
   * real gap rather than an oversight — named, so the next person to build one knows what to write.
   */
  evidence: string | null;
}

/**
 * D-HM9's order, which is the owner's process and §5's law, written down once.
 *
 * ⚠ The order of this array IS the order of the checklist. Nothing sorts it at read time.
 */
export const HIRING_STEPS: readonly HiringStepSpec[] = [
  {
    key: "invitation_sent", ordinal: "1", label: "Invitation sent",
    action: "Send the invitation",
    where: "remote", phase: "application",
    federalGate: false, beforeTravel: true, owes: "us", requires: [],
    evidence: "application_invitations",
  },
  {
    key: "permissions_signed", ordinal: "2", label: "Permissions signed",
    action: "Sign the permissions",
    where: "remote", phase: "application",
    federalGate: false, beforeTravel: true, owes: "them", requires: ["invitation_sent"],
    evidence: "driver_authorizations",
  },
  {
    key: "application_filled", ordinal: "3", label: "Application filled in",
    action: "Fill in the application",
    where: "remote", phase: "application",
    federalGate: true, beforeTravel: true, owes: "them", requires: ["permissions_signed"],
    evidence: "driver_applications",
  },
  {
    key: "office_approved", ordinal: "4", label: "Office approved it",
    action: "Read the application and approve it",
    where: "office", phase: "application",
    federalGate: false, beforeTravel: true, owes: "us", requires: ["application_filled"],
    evidence: "application_invitations.approved_at",
  },
  // ⚠ §391.23(a)(1) needs the record, and `SCREENING_PREREQUISITES.mvr_order` names what makes
  // ordering one lawful: the FCRA disclosure. It is NOT gated on the office approving — Q-HM2 ruled
  // there will never be an MVR integration, so this is pulled outside and uploaded, and an office
  // that has the disclosure may pull it whenever it likes.
  {
    key: "mvr", ordinal: "5", label: "Driving record",
    action: "Order the driving record",
    where: "office", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "us", requires: ["permissions_signed"],
    evidence: "qualification_records.mvr",
  },
  // ⚠ §5: "PSP is voluntary. It is a tool, not a requirement, which is why it can sit anywhere in
  // the order." Its prerequisites are the two signatures `SCREENING_PREREQUISITES.psp_record` names.
  {
    key: "psp", ordinal: "6", label: "PSP report",
    action: "Get the PSP report",
    where: "office", phase: "screening",
    federalGate: false, beforeTravel: true, owes: "us", requires: ["permissions_signed"],
    // ⚠ The REPORT, not the request. D-HM9's table names both — `psp_requests` is where an order
    // lives — but this string is only ever shown once the step is DONE, and what proves it is the
    // filed record. Both paths land there: `/psp-orders` files one on a settled order and
    // `/psp-imports` files one from a report bought on FMCSA's portal (D-HM6).
    evidence: "qualification_records.psp_report",
  },
  // ⚠ No prerequisite here, and that is deliberate rather than an omission. §382.701(a)'s full-query
  // consent is given INSIDE the FMCSA Clearinghouse, not on our screen — `clearinghouse` is
  // deliberately absent from `APPLICATION_RELEASE_ORDER` (D-REC4), so nothing we hold gates it.
  {
    key: "clearinghouse", ordinal: "7", label: "Clearinghouse query",
    action: "Run the Clearinghouse query",
    where: "office", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "us", requires: [],
    evidence: "qualification_records.clearinghouse_full",
  },
  // ⚠ §382.301(a) wants a VERIFIED NEGATIVE, and §5 is emphatic that collection is not clearance:
  // allowing a driver to operate before the result arrives violates it even if the result is later
  // negative. So the evidence is the record, never the appointment.
  {
    key: "drug_test", ordinal: "8", label: "Drug test result",
    action: "Get the drug test result",
    where: "external", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "them", requires: ["permissions_signed"],
    evidence: "qualification_records.drug_test",
  },
  // ⚠ The step that was missing until the owner recited the six gates back (D-HM9). The application
  // CAPTURES the card — `medical_card` is an `APPLICATION_CAPTURE_SLOTS` entry — and capture had
  // been silently mistaken for the gate. Checking the examiner against the National Registry is a
  // separate act with its own kind, which is why this requires the application and not the capture.
  {
    key: "medical_certificate", ordinal: "8b", label: "Medical certificate verified",
    action: "Verify the medical certificate",
    where: "office", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "us", requires: ["application_filled"],
    evidence: "qualification_records.medical_registry_verification",
  },
  // ⚠ NO EVIDENCE TABLE. `DRIVER-TRAINING-PLAN.md` specifies the whole system in 1,396 lines and
  // none of it is built: there is not one `training_*` table in any migration. Q-HM3 ruled these are
  // assigned to an APPLICANT before they travel, which is what buys the half-day orientation — so
  // this is the single most valuable unbuilt step in the list, and it is D4 in the queue.
  {
    key: "orientation_videos", ordinal: "9", label: "Orientation videos",
    action: "Finish the orientation videos",
    where: "remote", phase: "orientation",
    federalGate: false, beforeTravel: true, owes: "them", requires: ["office_approved"],
    evidence: null,
  },
  // ⚠ Blocked by the drug test on the STRICTER of two readings, and §5.1 is worth reading before
  // anybody changes this. FMCSA has said IN WRITING that the Clearinghouse query may follow a road
  // test, so the query is deliberately not a prerequisite. The drug-test half is an inference — that
  // §382.301(a) attaches to the first safety-sensitive function, that §382.107 makes driving a CMV
  // one, and that §391.31 requires the applicant to drive — drawn by every commercial source and by
  // none of them FMCSA. Q-HM1/Q-REC5 is open; D-REC7's principle is to take the answer that can only
  // be stricter than necessary, and §4.2 says the strict reading is also the industry's practice.
  {
    key: "road_test", ordinal: "10", label: "Road test",
    action: "Run the road test",
    where: "office", phase: "office_day",
    federalGate: true, beforeTravel: false, owes: "us", requires: ["drug_test"],
    evidence: "qualification_records.road_test",
  },
  // ⚠ NO EVIDENCE TABLE. Q-HM7 ruled this is named SECTIONS inside a day, with attendance — R8
  // specifies it and nothing is built. D3 in the queue.
  {
    key: "live_orientation", ordinal: "11", label: "Live orientation",
    action: "Hold the orientation day",
    where: "office", phase: "orientation",
    federalGate: false, beforeTravel: false, owes: "us", requires: ["office_approved"],
    evidence: null,
  },
  // ⚠ NO EVIDENCE TABLE, and the reason is one CHECK constraint: D-HM10 makes the handbook its own
  // instrument, which needs 0215's `purpose` widened. ⚠ It must land in NEITHER
  // `APPLICATION_RELEASE_ORDER` nor `SCREENING_PREREQUISITES`, or it arrives on a phone two weeks
  // before the office day it belongs to. D3 in the queue.
  {
    key: "handbook", ordinal: "12", label: "Handbook signed",
    action: "Sign the handbook",
    where: "office", phase: "orientation",
    federalGate: false, beforeTravel: false, owes: "them", requires: ["office_approved"],
    evidence: null,
  },
  // ⚠ The gate here is SQL, not an opinion: `record_packet_mark` raises DR032 until `approved_at` is
  // set (migration 0339). The checklist agreeing with the database is the point.
  {
    key: "application_signed", ordinal: "13", label: "Application signed",
    action: "Sign the application packet",
    where: "office", phase: "office_day",
    federalGate: false, beforeTravel: false, owes: "them", requires: ["office_approved"],
    evidence: "application_packet_marks",
  },
  // ⚠ Requires every federal gate, because that is what the owner said hiring IS: "hiring is
  // concluded when applicant is in the office and everything is done and signed and then we do
  // hiring." Listed explicitly rather than computed from `federalGate`, so that reading this row
  // tells you what it waits for.
  {
    key: "hired", ordinal: "14", label: "Hired",
    action: "Hire and open the driver file",
    where: "office", phase: "hire",
    federalGate: false, beforeTravel: false, owes: "us",
    requires: [
      "application_filled", "mvr", "clearinghouse", "drug_test",
      "medical_certificate", "road_test", "application_signed",
    ],
    evidence: "drivers.hire_date",
  },
];

/**
 * One step's spec by key, for a caller that holds a key and needs its words.
 *
 * ⚠ Total rather than `| undefined`: `HiringStepKey` is a closed union and `HIRING_STEPS` covers
 * every member of it, so a miss means the two have drifted apart — which is a bug in this file, not
 * a case a caller should be made to handle with a `?.`. It throws rather than returning a
 * placeholder, because a board row silently labelled "" is the failure that would go unnoticed.
 */
export function hiringStep(key: HiringStepKey): HiringStepSpec {
  const found = HIRING_STEPS.find((s) => s.key === key);
  if (!found) throw new Error(`hiringStep: no spec for "${key}" — HIRING_STEPS and HiringStepKey have drifted`);
  return found;
}

/** The steps this schema can actually prove, in D-HM9's order. Everything else is not a step yet. */
export const measurableHiringSteps = (): HiringStepSpec[] =>
  HIRING_STEPS.filter((s) => s.evidence !== null);
