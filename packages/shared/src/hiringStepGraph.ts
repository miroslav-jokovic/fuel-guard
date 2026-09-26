/**
 * The SHAPE of the hiring process — its node keys, the edges between them, and what each node must
 * carry — with the ruled catalogue itself left in `hiringSteps.ts`.
 *
 * ⚠ **Split out of `hiringSteps.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, before C2
 * inserts two steps into `HIRING_STEPS` and that file grows past its budget. The seam is vocabulary
 * versus ruling: a `HiringStepSpec` is a node, `requires` its edges, `HiringEvidence` what proves it,
 * and none of that depends on WHICH steps the owner ruled. `hiringSteps.ts` imports these types and
 * re-exports this module whole, so every `import … from "./hiringSteps.js"` still resolves, and this
 * module imports nothing back — the derived lists there evaluate `HIRING_STEPS` at load, so a cycle
 * would put them in its temporal dead zone.
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
  | "qualification_records.handbook"
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
