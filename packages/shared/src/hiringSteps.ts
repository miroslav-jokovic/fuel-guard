/**
 * The owner's hiring process — D-HM9's steps as amended since — written down exactly once.
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
 * Screening happens before the applicant gets on a plane; the road test onwards happens while they
 * stand in the office. `beforeTravel` is that seam, `readyToTravel` is that predicate over this
 * array; D-AW7 (2026-09-26) made it a refusal on the ticket, and §9 P4 (2026-10-31) made it a warning
 * again (`TRAVEL_WARNS_ON`). Since P4 only `REFUSING_STEPS` refuse; every other edge here is advice.
 */

import type { HiringStepDefinition, HiringStepKey, HiringStepSpec } from "./hiringStepGraph.js";
import type { HiringChecklistInputs } from "./hiringChecklistInputs.js";
import { orientationVideosMeasurable } from "./orientationVideosContract.js";

// The vocabulary — `HiringStepKey`, `HiringPhase`, `HiringEvidence`, `HiringStepSpec` and the phase
// labels — lives next door since C1 (2026-09-26); re-exported so no import path changed.
export * from "./hiringStepGraph.js";

/**
 * The owner's order — `APPLICANT-FLOW-PLAN.md` §3.3 since 2026-09-24, superseding D-HM9's, and
 * APPLICATION-FLOW-V2-PLAN §7 since 2026-09-26 — with §5's law inside it, written down once.
 *
 * ⚠ The order of this array IS the order of the checklist. Nothing sorts it at read time, and the
 * number each row shows is its position here (`HIRING_STEPS` below stamps it).
 */
const DEFINED: readonly HiringStepDefinition[] = [
  {
    key: "invitation_sent", label: "Invitation sent",
    action: "Send the invitation",
    where: "remote", phase: "application",
    federalGate: false, beforeTravel: true, owes: "us", requires: [],
    evidence: { table: "application_invitations", label: "Invitation" },
  },
  // ⚠ D-AW1/D-AW2 (APPLICATION-FLOW-V2-PLAN §7): Part 1 — identity, phone, address, every licence held
  // in three years, the CDL and medical-card photos — is the applicant's first visit, and the
  // permissions come after it because the office screens on what Part 1 collects: a permission signed
  // before the licences exist authorises a search nobody can run yet. The SQL agrees — on a v2 link
  // `recordRelease` refuses `intake_incomplete` (C2a). Not a federal gate: nothing in §391 names it.
  //
  // ⚠ The LEGACY rule is the fold's, not this row's (`hiringChecklist.ts`): an invitation with no Part 1
  // row — all eight in production on 2026-09-26 — reads done once its permission ceremony closed or its
  // identity is on the driver's row, because 0365's identity screen was their Part 1.
  {
    key: "intake_completed", label: "Part 1 finished",
    action: "Finish Part 1 of the application",
    where: "remote", phase: "screening",
    federalGate: false, beforeTravel: true, owes: "them", requires: ["invitation_sent"],
    evidence: { table: "application_invitations.intake_completed_at", label: "Part 1" },
  },
  {
    key: "permissions_signed", label: "Permissions signed",
    action: "Sign the permissions",
    where: "remote", phase: "application",
    federalGate: false, beforeTravel: true, owes: "them", requires: ["intake_completed"],
    evidence: { table: "driver_authorizations", label: "Authorizations" },
  },
  // ⚠ §391.23(a)(1) needs the record, and `SCREENING_PREREQUISITES.mvr_order` names what makes
  // ordering one lawful: the FCRA disclosure. It is NOT gated on the office approving — Q-HM2 ruled
  // there will never be an MVR integration, so this is pulled outside and uploaded, and an office
  // that has the disclosure may pull it whenever it likes.
  {
    key: "mvr", label: "Driving record",
    action: "Order the driving record",
    where: "office", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "us", requires: ["permissions_signed"],
    evidence: { table: "qualification_records.mvr", label: "MVR report" },
  },
  // ⚠ §5: "PSP is voluntary. It is a tool, not a requirement, which is why it can sit anywhere in
  // the order." Its prerequisites are the two signatures `SCREENING_PREREQUISITES.psp_record` names.
  {
    key: "psp", label: "PSP report",
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
    key: "clearinghouse", label: "Clearinghouse query",
    action: "Run the Clearinghouse query",
    where: "office", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "us", requires: [],
    evidence: { table: "qualification_records.clearinghouse_full", label: "Query result" },
  },
  // ⚠ §382.301(a) wants a VERIFIED NEGATIVE, and §5 is emphatic that collection is not clearance:
  // allowing a driver to operate before the result arrives violates it even if the result is later
  // negative. So the evidence is the record, never the appointment.
  {
    key: "drug_test", label: "Drug test result",
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
    key: "application_sent", label: "Application sent",
    action: "Send the application",
    where: "office", phase: "application",
    federalGate: false, beforeTravel: true, owes: "us", requires: ["permissions_signed"],
    evidence: { table: "application_invitations.application_sent_at", label: "Sent" },
  },
  {
    key: "application_filled", label: "Application filled in",
    action: "Fill in the application",
    where: "remote", phase: "application",
    federalGate: true, beforeTravel: true, owes: "them", requires: ["application_sent"],
    evidence: { table: "driver_applications", label: "Application" },
  },
  {
    key: "office_approved", label: "Office approved it",
    action: "Read the application and approve it",
    where: "office", phase: "application",
    // ⚠ Not before travel since §7 (D-AW7): the owner buys the ticket before the office reads the
    // application — *"travel (8) before review (9)"* — so a plane ticket waiting on this row would be
    // a wait the owner does not have.
    federalGate: false, beforeTravel: false, owes: "us", requires: ["application_filled"],
    evidence: { table: "application_invitations.approved_at", label: "Approval" },
  },
  // ⚠ The step that was missing until the owner recited the six gates back (D-HM9). Capture had been
  // silently mistaken for the gate. Checking the examiner against the National Registry is a separate
  // act with its own kind, which is why this requires the step that brings the card in, not the card.
  //
  // ⚠ That step is Part 1 since §7 (D-AW4), and it was the application: C2a moved the `medical_card`
  // photo out of `APPLICATION_ONLY_CAPTURE_SLOTS` and `complete_applicant_intake` files it when Part 1
  // finishes, weeks before the form. Requiring the application would hold a verification the office
  // can do on day three behind a form it sends on day ten.
  {
    key: "medical_certificate", label: "Medical certificate verified",
    action: "Verify the medical certificate",
    where: "office", phase: "screening",
    federalGate: true, beforeTravel: true, owes: "us", requires: ["intake_completed"],
    evidence: { table: "qualification_records.medical_registry_verification", label: "Registry check" },
  },
  // ⚠ D-AW7 (APPLICATION-FLOW-V2-PLAN §7): the trip is recorded (`applicant_travel`). The writer
  // refused until everything before travel was done (Q-HM5) until §9 P4 (2026-10-31), which made it a
  // warning (`TRAVEL_WARNS_ON`): no rule covers a plane ticket (audit §2, G2). Here, after the last
  // screening step, because that is where the owner's fourteen put it (§6.5, "Travel (8)"). No
  // `requires`: the warning is the panel's, read from the fold.
  {
    key: "travel_booked", label: "Travel booked",
    action: "Book the applicant's travel",
    where: "office", phase: "screening",
    federalGate: false, beforeTravel: false, owes: "us", requires: [],
    evidence: { table: "applicant_travel", label: "Itinerary" },
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
    key: "employment_investigation", label: "Previous employers checked",
    action: "Contact the previous employers",
    where: "office", phase: "screening",
    federalGate: false, beforeTravel: false, owes: "us", requires: ["application_filled"],
    // ⚠ The ATTEMPTS, not the replies. §391.23(c)(1) accepts "documentation of good faith efforts"
    // in place of an answer and §391.23(c)(2) requires a record of "the attempts made", so the
    // written record IS the deliverable when nobody writes back — which is why 0223 stores one row
    // per attempt rather than one per employer.
    evidence: { table: "employer_inquiries", label: "Inquiry record" },
  },
  // Q-HM3 ruled these are assigned to an APPLICANT before they travel, which is what buys the half-day
  // orientation. HW8a (0539, HIRING-WORKFLOW-AUDIT §4.8/§8.2) gives it evidence: the carrier's list of
  // links and the applicant's "I watched these" (`orientation_video_attestations`). It is measured only
  // for a carrier with at least one required video (`orientationVideosMeasurable`); `DRIVER-TRAINING-
  // PLAN.md`'s micro-LMS stays the later version.
  {
    key: "orientation_videos", label: "Orientation videos",
    action: "Finish the orientation videos",
    where: "remote", phase: "orientation",
    // AF4 (plan §3.3): the videos follow the drug test, not the approval — they are sent once the
    // result is in, and they are what fills the wait for travel.
    //
    // ⚠ Not before travel since §7 (Q-AW23's default, 2026-09-26), and HW8a leaves it there: Q-WF8 asks
    // the owner whether any video is required before travel, and until he answers, putting it in
    // `TRAVEL_WARNS_ON` would warn every booking about videos most carriers have not listed yet.
    //
    // ⚠ `owes: "us"` since HW8a, and it was "them": nothing reaches the driver until the office sends the
    // link, so the office's move comes first; the send (`orientation_videos_sent_at`) is what hands it
    // to "Waiting on them" — `application_signed`'s pattern.
    federalGate: false, beforeTravel: false, owes: "us", requires: ["drug_test"],
    evidence: { table: "orientation_video_attestations", label: "Videos watched" },
  },
  // ⚠ Blocked by the drug test on the STRICTER of two readings, and §5.1 is worth reading before
  // anybody changes this. FMCSA has said IN WRITING that the Clearinghouse query may follow a road
  // test, so the query is deliberately not a prerequisite. The drug-test half is an inference — that
  // §382.301(a) attaches to the first safety-sensitive function, that §382.107 makes driving a CMV
  // one, and that §391.31 requires the applicant to drive — drawn by every commercial source and by
  // none of them FMCSA. Q-HM1/Q-REC5 is open; D-REC7's principle is to take the answer that can only
  // be stricter than necessary, and §4.2 says the strict reading is also the industry's practice.
  {
    key: "road_test", label: "Road test",
    action: "Run the road test",
    where: "office", phase: "office_day",
    federalGate: true, beforeTravel: false, owes: "us", requires: ["drug_test"],
    evidence: { table: "qualification_records.road_test", label: "Certificate" },
  },
  // ⚠ NO EVIDENCE TABLE. Q-HM7 ruled this is named SECTIONS inside a day, with attendance — R8
  // specifies it and nothing is built. D3 in the queue.
  {
    key: "live_orientation", label: "Live orientation",
    action: "Hold the orientation day",
    where: "office", phase: "orientation",
    federalGate: false, beforeTravel: false, owes: "us", requires: ["office_approved"],
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
    key: "application_signed", label: "Application signed",
    action: "Sign the application packet in the office",
    where: "office", phase: "office_day",
    federalGate: false, beforeTravel: false, owes: "us", requires: ["office_approved"],
    evidence: { table: "application_packet_marks", label: "Signed packet" },
  },
  // ⚠ AFTER the packet, and that is the owner's ruling rather than an accident of order (D-HB1,
  // 2026-09-25): *"add it as separate step between Application Signed and Hired"*. It was step 15,
  // before the packet (D-HM10). Two things follow from the new place: the driver's adopted signature
  // already exists, so the handbook is signed with it; and the receipt's own sentence — *"I certify
  // that I have passed a safety training"* — is true when it is signed. Since 0533 (§9 P3) the marks
  // no longer wait on the filed application (HB022 dropped); filing the handbook still waits on the
  // countersigned packet (PC030, 0388), so it is advised after the packet and not refused.
  //
  // ⚠ `owes: "us"` for `application_signed`'s reason: the office sends the envelope at the desk, the
  // driver signs its five places straight after the application on the same link (D-AW16, C3s4b), then
  // the office countersigns for the carrier (D-HB3). The fold reads "opened, driver not finished" as
  // theirs.
  //
  // ⚠ Never in `APPLICATION_RELEASE_ORDER` or `SCREENING_PREREQUISITES` (D-HM10): it is not a
  // permission, and it authorises no vendor call.
  {
    key: "handbook", label: "Handbook signed",
    action: "Sign the driver handbook in the office",
    where: "office", phase: "office_day",
    federalGate: false, beforeTravel: false, owes: "us", requires: ["application_signed"],
    evidence: { table: "qualification_records.handbook", label: "Signed handbook" },
  },
  // ⚠ Its `requires` is `HIRE_REFUSES_WITHOUT`, stamped below (G-11, APPLICATION-FLOW-V2-PLAN §7).
  // Until 2026-09-26 this row listed its own nine — the six gates, the packet, the handbook and the
  // Q-HM9 investigation — beside `HIRE_REFUSES_WITHOUT` and `readyToHire`: three definitions of "ready
  // to hire" that disagreed. The row read "Blocked by Previous employers checked" while the hire, which
  // Q-HM5 lets proceed with that open (§391.23(c)(1)'s 30 days run from the first day), went through.
  // Now the row is blocked exactly when the hire refuses — the six federal checks since §9 P4.
  {
    key: "hired", label: "Hired",
    action: "Hire and open the driver file",
    where: "office", phase: "hire",
    federalGate: false, beforeTravel: false, owes: "us", requires: [],
    evidence: { table: "drivers.hire_date", label: "Driver file" },
  },
];

/**
 * What recording the trip WARNS about when still open — every step before travel.
 *
 * ⚠ It REFUSED until 2026-10-31 (D-AW7, Q-HM5: *"we will not even bring him if this not green"*).
 * HIRING-WORKFLOW-AUDIT-2026-10-31 §2 (G2) measured it as preference — no rule covers a plane ticket,
 * and PSP, in the list, is voluntary — and the owner's complaint that the software dictates the order
 * is the ruling §9 P4 implements: the office books, the panel shows "Still open: …" first.
 * Derived from `beforeTravel`, so the warning and `readyToTravel` read one predicate.
 */
export const TRAVEL_WARNS_ON: readonly HiringStepKey[] =
  DEFINED.filter((s) => s.beforeTravel).map((s) => s.key);

/**
 * What the hire REFUSES without (Q-HM5; `hireApplicant.ts`) — and since G-11 the ONE definition of
 * "ready to hire": the `hired` row's edges and `readyToHire` both read it.
 *
 * ⚠ Q-HM5 (2026-09-17): *"readyToHire refuses the hire outright on all six"* federal gates, and
 * *"everything that is not one of the six warns and never blocks"*. D-HB5 (2026-09-25) added the
 * handbook; **Q-WF6, as assumed in HIRING-WORKFLOW-AUDIT §8.3, takes it out again (2026-10-31, §9
 * P4)**: nothing non-federal blocks the hire, and §9 P12 makes the handbook a per-carrier switch.
 * So: the six `federalGate` steps, derived, and nothing else. The orientation videos and day are not
 * here either (Q-AW23's default; Q-WF6).
 */
export const HIRE_REFUSES_WITHOUT: readonly HiringStepKey[] = DEFINED.filter((s) => s.federalGate).map((s) => s.key);

/**
 * The carrier's hire policy (§9 P12, migrations 0536 and 0539): which NON-federal steps this carrier's hire
 * also waits for. The six federal checks are not here — they are law, not policy, and no switch removes them.
 *
 * ⚠ The handbook and, since HW8a (0539), the orientation videos. The live orientation day still has
 * `evidence: null`, so the fold could never mark it done and a carrier who switched it on could never hire
 * again (0536 header); it joins with HW8b's evidence. A switched-on step the fold cannot measure for THIS
 * carrier — the videos with no required video listed — waits for nothing (`hiringChecklist`'s hire list).
 */
export interface HirePolicy {
  handbook_blocks_hire: boolean;
  videos_block_hire: boolean;
}

/** Q-WF6 as assumed (§8.3): nothing non-federal blocks the hire. An org with no settings row reads this. */
export const HIRE_POLICY_DEFAULT: HirePolicy = { handbook_blocks_hire: false, videos_block_hire: false };

/** Each switch and the step it adds to the hire's refusal list — the one mapping every reader uses. */
export const HIRE_POLICY_SWITCHES: ReadonlyArray<{ setting: keyof HirePolicy; step: HiringStepKey }> = [
  { setting: "videos_block_hire", step: "orientation_videos" },
  { setting: "handbook_blocks_hire", step: "handbook" },
];

/**
 * What THIS carrier's hire refuses without: the six federal checks plus every step its policy switches on,
 * in the catalogue's order. `HIRE_REFUSES_WITHOUT` is this with every switch off.
 */
export function hireRefusesWithout(policy: Partial<HirePolicy> = HIRE_POLICY_DEFAULT): HiringStepKey[] {
  const on = new Set(HIRE_POLICY_SWITCHES.filter((s) => policy[s.setting] === true).map((s) => s.step));
  return DEFINED.filter((s) => s.federalGate || on.has(s.key)).map((s) => s.key);
}

/**
 * The row whose edges ARE a refusal list, stamped here because the list is derived from the catalogue
 * and a literal above cannot read a value computed from itself. Only `hired` since §9 P4: travel
 * warns (`TRAVEL_WARNS_ON`).
 */
const REFUSAL_EDGES: Partial<Record<HiringStepKey, readonly HiringStepKey[]>> = {
  hired: HIRE_REFUSES_WITHOUT,
};

/**
 * The steps whose `requires` the product REFUSES on (§9 P4) — every other edge in the catalogue is the
 * owner's advised order and never stops anybody.
 *
 *   · `hired` — the six federal checks (Q-WF1 (a)).
 *   · `mvr`, `psp` — the applicant's signed consent is LAW (FCRA §604(b)(2); 49 USC 31150), and the
 *     record and order writers refuse without it (`hiringEvidence.ts`, `pspOrder.ts`; audit §2 G8/G9).
 *
 * The fold reads this: a step in the set with an unmet requirement is "Blocked"; any other step with
 * one is worked as usual and names it as `advisedFirst` ("Usually after: …").
 */
export const REFUSING_STEPS: ReadonlySet<HiringStepKey> = new Set<HiringStepKey>(["hired", "mvr", "psp"]);

/** The catalogue as every caller reads it: numbered by position, the two refusal rows given their edges. */
export const HIRING_STEPS: readonly HiringStepSpec[] = DEFINED.map((s, i) => ({
  ...s,
  ordinal: String(i + 1),
  requires: REFUSAL_EDGES[s.key] ?? s.requires,
}));

/**
 * What "Send the application" warns about when it is not done yet (AF4, D-AF5; plan §3.2).
 *
 * ⚠ It WARNS and never refuses: nothing in law puts screening before the application, only the
 * owner's order does. These are the four steps §3.3 puts between the permissions and the form, and
 * the API reads them from the checklist fold so the warning and the row cannot disagree.
 *
 * ⚠ Plus the medical certificate since §7 (2026-09-26): Part 1 brings the card in, so its
 * verification is screening now, done before the form like the other four.
 */
export const APPLICATION_SEND_WARNS_ON: readonly HiringStepKey[] = [
  // §9 P4: the permissions too, since 0533 dropped AI005 — the form no longer waits for them.
  "permissions_signed", "mvr", "psp", "clearinghouse", "drug_test", "medical_certificate",
];

/**
 * What "Send for signing" (AF5's "Open signing" until C3s3a) warns about when it is not done yet (AF5,
 * D-AF6; plan §3.2).
 *
 * ⚠ It WARNS and never refuses, like Send. Since §9 P3/P4 (0533 dropped AI006) the office's approval is
 * on the list too: the link can go before approval, and the packet itself still refuses a mark until
 * the office approves (DR032) — the applicant sees the reading copy meanwhile (D-HUI12). The list is
 * DERIVED rather than written out — every federal gate that belongs before travel, plus the road
 * test, which is recorded on the same office day and is the one gate a packet should not be signed
 * ahead of. A step added to the catalogue with `federalGate && beforeTravel` joins it by itself.
 */
export const OPEN_SIGNING_WARNS_ON: readonly HiringStepKey[] = [
  "office_approved",
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

/**
 * Can this step be measured for THIS applicant's carrier? (HW8a) A step with no evidence table never can;
 * the orientation videos can only once the carrier lists a required video — with none, "every required
 * video watched" is vacuously true, and a vacuous "done" certifies nothing.
 */
export function measuredFor(spec: Pick<HiringStepSpec, "key" | "evidence">, input: Pick<HiringChecklistInputs, "orientationVideos">): boolean {
  if (spec.evidence === null) return false;
  return spec.key !== "orientation_videos" || orientationVideosMeasurable(input.orientationVideos);
}
