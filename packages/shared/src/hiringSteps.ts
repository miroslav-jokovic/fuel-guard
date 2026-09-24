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
 * Everything up to the orientation videos happens before the applicant gets on a plane; the road
 * test onwards happens while they stand in the
 * office. `beforeTravel` is that seam, and `readyToTravel` is that predicate over this array.
 */

export type HiringStepKey =
  | "invitation_sent"
  | "permissions_signed"
  | "application_sent"
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
  | "employment_investigation"
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

/**
 * The row that proves a step — `"qualification_records.mvr"`, `"application_packet_marks"`.
 *
 * ⚠ A CLOSED UNION rather than `string`, added by B5 and load-bearing for a reason that is not
 * documentation. A surface that renders the artifact column has to answer *where does a reader go to
 * see this*, and that answer is a UI fact (it is a route) which cannot live in this package. With a
 * `string` here, the web app's map from artifact to address would go stale in silence the first time
 * a step was added: a new table name, no entry, a blank cell, nothing failing. As a union it is a
 * TYPE ERROR in `apps/web` until somebody says where the new artifact is reached — which is the only
 * kind of "remember to update the other file" that actually works.
 */
export type HiringEvidenceTable =
  | "application_invitations"
  | "application_invitations.approved_at"
  | "application_invitations.application_sent_at"
  | "driver_authorizations"
  | "driver_applications"
  | "qualification_records.mvr"
  | "qualification_records.psp_report"
  | "qualification_records.clearinghouse_full"
  | "qualification_records.drug_test"
  | "qualification_records.medical_registry_verification"
  | "qualification_records.road_test"
  | "application_packet_marks"
  | "employer_inquiries"
  | "drivers.hire_date";

/**
 * What proves a step: the row it lives in, and the words a reader is shown for it (B5, D-HUI3).
 *
 * ── WHY ONE OBJECT AND NOT TWO FIELDS BESIDE EACH OTHER ───────────────────────────────────────
 * D-HUI3 says the artifact column is the visible half of D-HM1's corollary — *a step with no
 * artifact cannot be a step* — and that **"if the column is empty for a row, that row should not
 * have shipped"**. As `evidence: string | null` plus an `artifactLabel: string | null` beside it,
 * that rule is a sentence in a plan: nothing stops a step shipping with a table and no words, and
 * the fold would emit the row anyway because the fold only looks at the table. Bound together, a
 * step either has both or has neither, and the rule is enforced by the compiler instead of by
 * whoever happens to review the next step.
 *
 * ⚠ `table` is NOT free to become a display string. It means *which row proves this*, it is read by
 * `hiringChecklist`'s emission filter and by the plan, and B5's whole reason for existing is that
 * `"qualification_records.mvr"` had been rendering on a recruiter's screen as if it were words.
 */
export interface HiringEvidence {
  /** The row that proves it. A machine fact — never rendered. */
  table: HiringEvidenceTable;
  /**
   * The artifact in the words the row shows: "MVR report", "Signed packet", "Authorizations".
   *
   * ⚠ It names the DOCUMENT a reader would open, not the step — the row already says the step in
   * its first column, and a third column repeating it is a column doing nothing. The mockup's
   * *"Packet (31 pp) ↗"* and *"Report ↗"* are the register: short, a noun, the thing itself.
   */
  label: string;
}

export interface HiringStepSpec {
  key: HiringStepKey;
  /**
   * The step's number in the owner's order, as a string.
   *
   * ⚠ **Renumbered on 2026-09-24 (AF4), deliberately.** These were D-HM9's numbers, kept as strings
   * because the medical certificate went in as `8b` and the investigation as `13b` rather than break
   * every reference in the plans to a step by its number. D-AF1..3 then changed the ORDER itself —
   * screening before the application, a new "application sent" step, signing in the office — so
   * D-HM9's numbers no longer described any sequence the office follows, and keeping them would have
   * made "step 5" mean the MVR in one plan and nothing in the product. `APPLICANT-FLOW-PLAN.md` §3.3 is
   * the order now; a reference in an older plan to "step N" means D-HM9's list, which that plan
   * reproduces. `HIRING_STEPS.length` is the count, and nothing restates it.
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
  /** Everything before the plane ticket. `readyToTravel` is exactly this predicate over the catalogue. */
  beforeTravel: boolean;
  /** Who moves next when the step has not started. PSP is the one that also has an in-flight state. */
  owes: "us" | "them";
  /**
   * What must be done first, and every edge here is law or a database constraint — never a
   * preference. The office may act out of order on anything not listed (D-HUI7).
   */
  requires: readonly HiringStepKey[];
  /**
   * What proves it, or `null` when nothing in the schema can.
   *
   * ⚠ `null` is what keeps a step out of the fold. Three of them are `null` today and each one is a
   * real gap rather than an oversight — named, so the next person to build one knows what to write.
   */
  evidence: HiringEvidence | null;
}

/**
 * The owner's order — `APPLICANT-FLOW-PLAN.md` §3.3 since 2026-09-24, superseding D-HM9's — with
 * §5's law inside it, written down once.
 *
 * ⚠ The order of this array IS the order of the checklist. Nothing sorts it at read time.
 */
export const HIRING_STEPS: readonly HiringStepSpec[] = [
  {
    key: "invitation_sent", ordinal: "1", label: "Invitation sent",
    action: "Send the invitation",
    where: "remote", phase: "application",
    federalGate: false, beforeTravel: true, owes: "us", requires: [],
    evidence: { table: "application_invitations", label: "Invitation" },
  },
  {
    key: "permissions_signed", ordinal: "2", label: "Permissions signed",
    action: "Sign the permissions",
    where: "remote", phase: "application",
    federalGate: false, beforeTravel: true, owes: "them", requires: ["invitation_sent"],
    evidence: { table: "driver_authorizations", label: "Authorizations" },
  },
  // ⚠ §391.23(a)(1) needs the record, and `SCREENING_PREREQUISITES.mvr_order` names what makes
  // ordering one lawful: the FCRA disclosure. It is NOT gated on the office approving — Q-HM2 ruled
  // there will never be an MVR integration, so this is pulled outside and uploaded, and an office
  // that has the disclosure may pull it whenever it likes.
  {
    key: "mvr", ordinal: "3", label: "Driving record",
    action: "Order the driving record",
    where: "office", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "us", requires: ["permissions_signed"],
    evidence: { table: "qualification_records.mvr", label: "MVR report" },
  },
  // ⚠ §5: "PSP is voluntary. It is a tool, not a requirement, which is why it can sit anywhere in
  // the order." Its prerequisites are the two signatures `SCREENING_PREREQUISITES.psp_record` names.
  {
    key: "psp", ordinal: "4", label: "PSP report",
    action: "Get the PSP report",
    where: "office", phase: "screening",
    federalGate: false, beforeTravel: true, owes: "us", requires: ["permissions_signed"],
    // ⚠ The REPORT, not the request. D-HM9's table names both — `psp_requests` is where an order
    // lives — but this string is only ever shown once the step is DONE, and what proves it is the
    // filed record. Both paths land there: `/psp-orders` files one on a settled order and
    // `/psp-imports` files one from a report bought on FMCSA's portal (D-HM6).
    evidence: { table: "qualification_records.psp_report", label: "Report" },
  },
  // ⚠ No prerequisite here, and that is deliberate rather than an omission. This step is the
  // pre-employment FULL query (§382.701(a)), and its consent is given INSIDE the FMCSA Clearinghouse,
  // not on our screen, so nothing we hold gates it. The `clearinghouse` purpose that D-AF4 put in
  // `APPLICATION_RELEASE_ORDER` on 2026-09-24 is the LIMITED-query consent (§382.703(a)) — the
  // carrier's standing permission for the annual queries — and requiring it here would gate the full
  // query on a signature that does not authorise it.
  {
    key: "clearinghouse", ordinal: "5", label: "Clearinghouse query",
    action: "Run the Clearinghouse query",
    where: "office", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "us", requires: [],
    evidence: { table: "qualification_records.clearinghouse_full", label: "Query result" },
  },
  // ⚠ §382.301(a) wants a VERIFIED NEGATIVE, and §5 is emphatic that collection is not clearance:
  // allowing a driver to operate before the result arrives violates it even if the result is later
  // negative. So the evidence is the record, never the appointment.
  {
    key: "drug_test", ordinal: "6", label: "Drug test result",
    action: "Get the drug test result",
    where: "external", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "them", requires: ["permissions_signed"],
    evidence: { table: "qualification_records.drug_test", label: "Lab result" },
  },
  // ⚠ AF4, D-AF5: the office sends the form only once the permissions are in, and after whatever
  // screening it chooses to finish first. It WARNS on outstanding screening and never refuses on it
  // (nothing in law puts screening before the application), so this requires the permissions and
  // nothing else. The stamp is 0365's, set the first time the office presses Send.
  {
    key: "application_sent", ordinal: "7", label: "Application sent",
    action: "Send the application",
    where: "office", phase: "application",
    federalGate: false, beforeTravel: true, owes: "us", requires: ["permissions_signed"],
    evidence: { table: "application_invitations.application_sent_at", label: "Sent" },
  },
  {
    key: "application_filled", ordinal: "8", label: "Application filled in",
    action: "Fill in the application",
    where: "remote", phase: "application",
    federalGate: true, beforeTravel: true, owes: "them", requires: ["application_sent"],
    evidence: { table: "driver_applications", label: "Application" },
  },
  {
    key: "office_approved", ordinal: "9", label: "Office approved it",
    action: "Read the application and approve it",
    where: "office", phase: "application",
    federalGate: false, beforeTravel: true, owes: "us", requires: ["application_filled"],
    evidence: { table: "application_invitations.approved_at", label: "Approval" },
  },
  // ⚠ The step that was missing until the owner recited the six gates back (D-HM9). The application
  // CAPTURES the card — `medical_card` is an `APPLICATION_CAPTURE_SLOTS` entry — and capture had
  // been silently mistaken for the gate. Checking the examiner against the National Registry is a
  // separate act with its own kind, which is why this requires the application and not the capture.
  {
    key: "medical_certificate", ordinal: "10", label: "Medical certificate verified",
    action: "Verify the medical certificate",
    where: "office", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "us", requires: ["application_filled"],
    evidence: { table: "qualification_records.medical_registry_verification", label: "Registry check" },
  },
  // ⚠ THE FIFTEENTH STEP, added by Q-HM9 on 2026-09-18, and it is the only one here that D-HM9 did
  // not rule. It is in the catalogue because the alternative was measured and is worse: this
  // product builds the whole §391.23(a)(2) investigation — `employer_inquiries` (0223), the
  // §391.23(c)(2) written record, `inquiryQueue.ts`, the 30-day clock, a fleet-wide queue page —
  // and none of it was connected to the checklist a recruiter actually works from. `grep -c inquir`
  // on this file was 0. So a recruiter working the checklist alone could reach "Hired" with a
  // §391.51(b)(3) file requirement untouched, which is the single thing the checklist exists to
  // prevent. D-HM1's corollary admits it: its evidence table already exists.
  //
  // ── WHY IT IS NOT A `federalGate`, THOUGH IT IS FEDERAL ────────────────────────────────────
  // ⚠ `federalGate` does not mean "required by law" — it means one of §5's six things a carrier
  // must HOLD BEFORE THE DRIVER FIRST DRIVES, which is why the six are not reorderable and not
  // skippable. §391.23(c)(1) gives the carrier 30 days FROM THE DATE EMPLOYMENT BEGINS to have
  // either the replies or documented good-faith efforts on file, so this is lawfully still open on
  // the driver's first day. Marking it a seventh gate would shorten the law in the product's
  // favour and would break the one test that pins §5's six against FMCSA.
  //
  // ── WHERE IT SITS, AND WHY THAT IS NOT THE TRAVEL SEAM ─────────────────────────────────────
  // ⚠ Until 2026-09-24 this was `13b`, immediately before `hired`, and the reason given was the
  // TRAVEL SEAM: previous employers take weeks and their §391.23(g)(1) clock is their own, so gating
  // the plane ticket on their replies would stall every hire for a third party's silence. That
  // reason is kept whole — it is `beforeTravel: false`, and `readyToTravel` ignores it. What moved
  // is only its PLACE in the list: plan §3.3 puts it beside the medical certificate, because the
  // work starts the moment the application declares a history, and a row nobody sees until the
  // office day is a row nobody starts. The list is the order the office works; `beforeTravel` is
  // what the plane ticket waits for, and the two are separate facts.
  {
    key: "employment_investigation", ordinal: "11", label: "Previous employers checked",
    action: "Contact the previous employers",
    where: "office", phase: "screening",
    federalGate: false, beforeTravel: false, owes: "us", requires: ["application_filled"],
    // ⚠ The ATTEMPTS, not the replies. §391.23(c)(1) accepts "documentation of good faith efforts"
    // in place of an answer and §391.23(c)(2) requires a record of "the attempts made", so the
    // written record IS the deliverable when nobody writes back — which is why 0223 stores one row
    // per attempt rather than one per employer.
    evidence: { table: "employer_inquiries", label: "Inquiry record" },
  },
  // ⚠ NO EVIDENCE TABLE. `DRIVER-TRAINING-PLAN.md` specifies the whole system in 1,396 lines and
  // none of it is built: there is not one `training_*` table in any migration. Q-HM3 ruled these are
  // assigned to an APPLICANT before they travel, which is what buys the half-day orientation — so
  // this is the single most valuable unbuilt step in the list, and it is D4 in the queue.
  {
    key: "orientation_videos", ordinal: "12", label: "Orientation videos",
    action: "Finish the orientation videos",
    where: "remote", phase: "orientation",
    // AF4 (plan §3.3): the videos follow the drug test, not the approval — they are sent once the
    // result is in, and they are what fills the wait for travel.
    federalGate: false, beforeTravel: true, owes: "them", requires: ["drug_test"],
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
    key: "road_test", ordinal: "13", label: "Road test",
    action: "Run the road test",
    where: "office", phase: "office_day",
    federalGate: true, beforeTravel: false, owes: "us", requires: ["drug_test"],
    evidence: { table: "qualification_records.road_test", label: "Certificate" },
  },
  // ⚠ NO EVIDENCE TABLE. Q-HM7 ruled this is named SECTIONS inside a day, with attendance — R8
  // specifies it and nothing is built. D3 in the queue.
  {
    key: "live_orientation", ordinal: "14", label: "Live orientation",
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
    key: "handbook", ordinal: "15", label: "Handbook signed",
    action: "Sign the handbook",
    where: "office", phase: "orientation",
    federalGate: false, beforeTravel: false, owes: "them", requires: ["office_approved"],
    evidence: null,
  },
  // ⚠ The gate here is SQL, not an opinion: `record_packet_mark` raises DR032 until `approved_at` is
  // set (migration 0339), and since 0369 DR036 until `signing_opened_at` is. The checklist agreeing
  // with the database is the point.
  //
  // ⚠ `owes: "us"` since AF5, and it was "them". D-AF3 moved signing into the office: after
  // approval the next move is the office's — open signing at the desk — and only once it is opened
  // does the applicant owe the marks. The fold reads that opening as the step being in flight, which
  // is how a step that the office owes first hands over to "Waiting on them" (`hiringChecklist.ts`).
  {
    key: "application_signed", ordinal: "16", label: "Application signed",
    action: "Sign the application packet in the office",
    where: "office", phase: "office_day",
    federalGate: false, beforeTravel: false, owes: "us", requires: ["office_approved"],
    evidence: { table: "application_packet_marks", label: "Signed packet" },
  },
  // ⚠ Requires every federal gate, because that is what the owner said hiring IS: "hiring is
  // concluded when applicant is in the office and everything is done and signed and then we do
  // hiring." Listed explicitly rather than computed from `federalGate`, so that reading this row
  // tells you what it waits for.
  {
    key: "hired", ordinal: "17", label: "Hired",
    action: "Hire and open the driver file",
    where: "office", phase: "hire",
    federalGate: false, beforeTravel: false, owes: "us",
    requires: [
      "application_filled", "mvr", "clearinghouse", "drug_test",
      "medical_certificate", "road_test", "application_signed",
      // ⚠ Q-HM9: not a `federalGate` (see its row), and listed here anyway. The 30 days of
      // §391.23(c)(1) run from the date employment BEGINS, so the law permits hiring with this
      // open — but the owner's own definition does not (*"hiring is concluded when applicant is in
      // the office and everything is done and signed"*), and an investigation left for after the
      // hire is the one that gets forgotten. This is the row that stops "Hired" being offered with
      // a §391.51(b)(3) requirement untouched, which is the whole of Q-HM9.
      "employment_investigation",
    ],
    evidence: { table: "drivers.hire_date", label: "Driver file" },
  },
];

/**
 * What "Send the application" warns about when it is not done yet (AF4, D-AF5; plan §3.2).
 *
 * ⚠ It WARNS and never refuses: nothing in law puts screening before the application, only the
 * owner's order does. These are exactly the four steps §3.3 puts between the permissions and the
 * form, and the API reads them from the checklist fold so the warning and the row cannot disagree.
 */
export const APPLICATION_SEND_WARNS_ON: readonly HiringStepKey[] = ["mvr", "psp", "clearinghouse", "drug_test"];

/**
 * What "Open signing" warns about when it is not done yet (AF5, D-AF6; plan §3.2).
 *
 * ⚠ It WARNS and never refuses, like Send: the only refusal is the SQL's (not approved, AI006), and
 * whether the applicant is standing in the office is not something software can check. The list is
 * DERIVED rather than written out — every federal gate that belongs before travel, plus the road
 * test, which is recorded on the same office day and is the one gate a packet should not be signed
 * ahead of. A step added to the catalogue with `federalGate && beforeTravel` joins it by itself.
 */
export const OPEN_SIGNING_WARNS_ON: readonly HiringStepKey[] = [
  ...HIRING_STEPS.filter((s) => s.federalGate && s.beforeTravel).map((s) => s.key),
  "road_test",
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
