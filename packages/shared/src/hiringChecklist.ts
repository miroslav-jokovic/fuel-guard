import { hasLiveAuthorization, type AuthorizationRow } from "./authorizationContract.js";
import { APPLICATION_RELEASE_ORDER } from "./applicationIntake.js";
import { applicationReviewState, type ApplicationPhases } from "./applicationReviewContract.js";
import { packetDriverMarkCount } from "./packetPlacements.js";
import {
  HIRING_STEPS, measurableHiringSteps,
  type HiringEvidence, type HiringStepKey, type HiringStepSpec,
} from "./hiringSteps.js";

/**
 * Where a hire has got to, across all fourteen of the owner's steps (B1, `HIRING-MODULE-PLAN.md`).
 *
 * ── DERIVED, NEVER STORED (D-HM1) ─────────────────────────────────────────────────────────────
 * This is `applicantPipeline.ts`'s rule at four times the size, and its header says why in words
 * worth repeating: *"A stored stage is a second copy of facts the rows already carry, and it goes
 * stale the moment somebody records an authorization without remembering to advance it."* A
 * checklist of booleans is that failure fourteen times over — and a hiring file whose checklist
 * disagrees with its own evidence is worse than no checklist, because it is a document that gets
 * produced in an audit and contradicted by the file beside it.
 *
 * ⚠ **The corollary is the hard part: a step with no artifact cannot be a step.** The catalogue
 * below names all fourteen so that D-HM3's fixed federal order is written down exactly once — but
 * `hiringChecklist()` EMITS only the steps whose evidence exists in the schema today. Three do not
 * (see `evidence: null`), and they are absent from the fold rather than shown as permanently
 * outstanding. A row nobody can ever tick is a decoration, and a decoration on a compliance
 * checklist is a lie with a checkbox.
 *
 * ── AND THE SUMMARY OBEYS THE SAME RULE, WHICH IS THE SUBTLE HALF ─────────────────────────────
 * ⚠ `readyToTravel` cannot be a bare boolean. Step 9 — the orientation videos — is inside its range
 * and has no evidence table, so a boolean would answer "yes, travel" about a person who has watched
 * nothing. That is precisely the failure D-HM9 records against itself: the medical certificate was
 * missing for weeks because *capture* had been mistaken for *verification*, and the lesson written
 * down was **"a document being uploaded is not the same fact as a document being verified, and a
 * checklist that conflates them reports a gate as green that nobody has checked."** So both
 * readiness answers carry `unmeasured` — the steps the answer could not see. An empty `unmeasured`
 * is what makes `ok` mean what it says.
 *
 * ── TWO ANSWERS, NOT ONE (D-HM9, owner 2026-09-17) ────────────────────────────────────────────
 * The seam is TRAVEL. Steps 1–9 happen before the applicant gets on a plane; 10–14 happen while they
 * are standing in the office. So the fold answers two questions on two different days —
 * *"can this person travel yet?"* (*"we will not even bring him if this not green"*) and *"can we
 * hire them today?"* — and that split is the whole reason this is a checklist rather than a wizard.
 *
 * ── PURE, AND THAT IS WHY IT IS FIRST IN THE QUEUE ────────────────────────────────────────────
 * No clock, no network, no schema. Everything it needs is passed in as rows a caller already has, so
 * the office board (B3/B4), the applicant's own screen (D-HM2) and the tests all fold the same
 * evidence the same way — and the applicant can never be told they are waiting on us while the
 * office is told it is waiting on them. That disagreement is what §1's board defects were, twice.
 */

/**
 * The four states, and they are the whole vocabulary (D-HUI4).
 *
 * ⚠ Not ordered on a good/bad axis. `waiting_on_them` and `waiting_on_us` are equally "in progress"
 * and are completely different actions — which is why the UI renders an icon and a word rather than
 * a coloured dot, and why the only one that is ever visually loud is the one that means *you*.
 */
export type HiringStepState = "blocked" | "waiting_on_them" | "waiting_on_us" | "done";

export const HIRING_STEP_STATE_LABELS: Record<HiringStepState, string> = {
  blocked: "Blocked",
  waiting_on_them: "Waiting on them",
  waiting_on_us: "Waiting on you",
  done: "Done",
};

/**
 * What the fold reads. Rows a caller already has, never a query — this module reaches nothing.
 *
 * ⚠ Everything is optional-by-absence rather than required, because an applicant who has only just
 * been invited genuinely has none of it, and a shape that forced a caller to invent empty rows would
 * push that invention into three call sites.
 */
export interface HiringChecklistInputs {
  /** When the invitation was created. Null means nobody has been invited yet. */
  invitedAt?: string | null;
  /** The live invitation's three stamps — `reviewRequestedAt`, `approvedAt`, `submittedAt`. */
  phases?: ApplicationPhases | null;
  /** Has the applicant typed anything? The only evidence that exists before they send it (F5). */
  hasDraft?: boolean;
  authorizations?: readonly AuthorizationRow[];
  /**
   * The `kind` values present in this driver's `qualification_records`.
   *
   * ⚠ Kinds only, deduped — the fold asks "is there one" and nothing else, so handing it whole rows
   * would be handing it facts it must not start deciding with. Expiry and recurrence belong to
   * `dqCatalogue.ts`, which already owns them.
   */
  qualificationKinds?: readonly string[];
  /** PSP: whether a request has been made, and whether a report came back. */
  psp?: { requested: boolean; reportReceived: boolean } | null;
  /**
   * The §391.23(a)(2) investigation, already folded by `driverInquiryQueue` (Q-HM9).
   *
   * ⚠ Counts rather than rows, and folded by the caller rather than here, because
   * `driverInquiryQueue` needs `today` — the §391.23(a)(2) three-year window is measured from the
   * hire date or, for an applicant, from today. This module has no clock and is not getting one, so
   * the caller does the dated part and hands over the two numbers that survive it.
   *
   * ⚠ Absent means NOT DONE, never "nothing to do". A caller that forgets to read the inquiries
   * leaves the step outstanding, which is the failure that shows; the other way round it would
   * silently certify an investigation nobody performed.
   */
  investigation?: {
    /** Employers still needing a reply or a documented non-response (`outstanding.length`). */
    outstanding: number;
    /**
     * Of those, how many are `awaiting` — written to, with their §391.23(g)(1) 30 days still running.
     *
     * ⚠ Not "how many letters have been sent", which is what this was first and was wrong on screen.
     * `inquiryQueue.ts` has four open states and only ONE of them is the employer's move: `not_sent`
     * is a letter the office still owes, `overdue` is a chase or a documented non-response, and
     * `undeliverable` needs a different address. Rendered at 1440 with two employers outstanding and
     * one letter sent, a count-based rule put *"Waiting on them"* on a row where the office had not
     * written to one of them at all — telling a recruiter to sit still when the next move was theirs.
     */
    awaiting: number;
  } | null;
  /** How many of the packet's places this link has collected. The total is derived, never passed. */
  packetMarks?: number;
  /** The hire date, once there is one. */
  hiredAt?: string | null;
}

/** One row of the checklist: D-HUI3's three questions, plus what to say when it is blocked. */
export interface HiringStep extends HiringStepSpec {
  state: HiringStepState;
  /**
   * The artifact that proves it — its words and its row (D-HUI3's third column, load-bearing).
   *
   * ⚠ Null until the step is done, and that is the honest reading: before an MVR is uploaded there
   * is no artifact, and a column that named one anyway would be saying where the proof WOULD live
   * rather than that it exists.
   *
   * ⚠ It is the spec's `evidence` verbatim rather than a projection of it, and that is deliberate:
   * a renderer needs BOTH halves — `label` for the words and `table` for the address it routes to —
   * and handing over only the label would push the address back onto a step-key switch in the page,
   * which is the copy `hiringSteps.ts`'s own header argues against. What this field adds over
   * `spec.evidence` is the one fact the fold owns: whether the proof is there yet.
   */
  artifact: HiringEvidence | null;
  /** When blocked, the first unmet requirement — so the row names its blocker in words, not a grey. */
  blockedBy: HiringStepKey | null;
}

/**
 * An answer, plus the steps the answer could not see.
 *
 * ⚠ `ok` is only trustworthy when `unmeasured` is empty, and separating them is what stops this
 * repeating the medical-certificate mistake at the summary level: an answer that quietly treats
 * "we have no way to check" as "checked" is the exact failure D-HM9 wrote down.
 */
export interface HiringReadiness {
  ok: boolean;
  /** Steps in range whose evidence does not exist in the schema yet. */
  unmeasured: HiringStepKey[];
  /** Steps in range that are measurable and not done. */
  outstanding: HiringStepKey[];
}

export interface HiringChecklist {
  /** Only the measurable steps, in D-HM9's order. Completed ones stay — the count must not renumber. */
  steps: HiringStep[];
  done: number;
  total: number;
  /** Steps 1–9: the gate on the plane ticket. */
  readyToTravel: HiringReadiness;
  /** All fourteen: the gate on the hire itself. */
  readyToHire: HiringReadiness;
  /** The one action to lead with — the office's own first, because that is what it can do today. */
  next: HiringStepKey | null;
}

/** Is there a `qualification_records` row of this kind? */
const hasKind = (input: HiringChecklistInputs, kind: string): boolean =>
  (input.qualificationKinds ?? []).includes(kind);

/**
 * Whether a step's evidence exists, and whether something is out for it.
 *
 * ⚠ `inFlight` is how a step says "sent, not returned" rather than "nobody has started" — D-HUI4's
 * distinction between chasing and acting. Only PSP can be in flight today, because it is the only
 * one of these with a request record; the others are a single row that either exists or does not.
 */
function evidenceFor(
  key: HiringStepKey,
  input: HiringChecklistInputs,
): { done: boolean; inFlight: boolean } {
  const review = input.phases ? applicationReviewState(input.phases) : null;
  switch (key) {
    case "invitation_sent":
      return { done: Boolean(input.invitedAt), inFlight: false };
    case "permissions_signed":
      // ⚠ Every one the applicant is ASKED for, from `APPLICATION_RELEASE_ORDER` rather than from
      // `AUTHORIZATION_PURPOSES`. Since D-AF4 (2026-09-24) the two lists hold the same five, but the
      // catalogue may grow a purpose no applicant signs, and reading it would hold this step open
      // for ever. ⚠ An applicant who signed the four before D-AF4 reads NOT done until the office
      // records the Clearinghouse limited-query consent (`POST /authorizations`, wet signature).
      return {
        done: APPLICATION_RELEASE_ORDER.every((p) => hasLiveAuthorization(input.authorizations ?? [], p)),
        inFlight: (input.authorizations ?? []).length > 0,
      };
    case "application_filled":
      // Sent to the office, or anything after that. `filling` is not done, however much is typed.
      return {
        done: review !== null && review !== "filling",
        inFlight: input.hasDraft === true,
      };
    case "office_approved":
      return { done: review === "approved" || review === "certified", inFlight: false };
    case "mvr":
      return { done: hasKind(input, "mvr"), inFlight: false };
    case "psp":
      // ⚠ Done is the REPORT, not the request. A request that was billed and came back empty is a
      // request, and §5 calls PSP a tool rather than a requirement — so this is the one step where
      // "we have asked" is a real, visible middle state instead of a silent nothing.
      return {
        done: input.psp?.reportReceived === true,
        inFlight: input.psp?.requested === true,
      };
    case "clearinghouse":
      return { done: hasKind(input, "clearinghouse_full"), inFlight: false };
    case "drug_test":
      return { done: hasKind(input, "drug_test"), inFlight: false };
    case "medical_certificate":
      return { done: hasKind(input, "medical_registry_verification"), inFlight: false };
    case "road_test":
      // ⚠ `cdl_equivalency` counts, and `dqCatalogue.ts` already says so: §391.51(b)(4) accepts a
      // road test OR the §391.33 licence equivalency. One requirement, two lawful evidences.
      return {
        done: hasKind(input, "road_test") || hasKind(input, "cdl_equivalency"),
        inFlight: false,
      };
    case "application_signed":
      // ⚠ Against the DERIVED count, never a stored stamp — `packetDriverMarkCount()` is the whole
      // of 0339's argument for not adding a `packet_signing_completed_at` column that would go stale
      // the next time counsel rules on page 19's duplicate.
      return {
        done: (input.packetMarks ?? 0) >= packetDriverMarkCount(),
        inFlight: (input.packetMarks ?? 0) > 0,
      };
    case "employment_investigation": {
      // ⚠ THE GATE IS THE APPLICATION, NOT THE COUNT, and conflating them is the whole defect this
      // case is written against. `driverInquiryQueue.complete` is `outstanding.length === 0`, which
      // is **vacuously true for a driver whose employment history nobody has typed yet** — no
      // employers owed, nothing outstanding, "complete". A step reading that number alone would go
      // green on the day the invitation was sent, for an applicant who has declared nothing.
      //
      // That is D-HM9's own recorded mistake in a third costume: the medical certificate was
      // missing for weeks because CAPTURE had been mistaken for VERIFICATION, and the lesson
      // written down was that a checklist which conflates them "reports a gate as green that nobody
      // has checked". An empty employment history is the same shape — an absence of evidence read
      // as evidence of completeness.
      //
      // ⚠ Once the application is FILED the history is declared, and only then does zero mean zero:
      // an applicant with no DOT-regulated employer inside the §391.23(a)(2) three-year window
      // genuinely has nobody to write to, and their investigation is complete rather than empty.
      // A first-time driver must not be held against a row that can never be satisfied.
      const historyDeclared = review !== null && review !== "filling";
      const queue = input.investigation;
      return {
        // ⚠ `queue == null` is NOT DONE — see the field's own note. Fail-closed, for the same
        // reason a null RLS predicate denies rather than admits.
        done: historyDeclared && queue != null && queue.outstanding === 0,
        // ⚠ Theirs ONLY when there is nothing left for the office to do — every outstanding employer
        // written to and still inside their own 30 days. One `not_sent`, `overdue` or `undeliverable`
        // among them and the next move is ours, whatever else has been sent. See `awaiting`'s note:
        // the count-based version of this rule shipped "Waiting on them" over an unwritten letter.
        inFlight: queue != null && queue.outstanding > 0 && queue.awaiting === queue.outstanding,
      };
    }
    case "hired":
      return { done: Boolean(input.hiredAt), inFlight: false };
    // The three with no evidence table. Reached only if a caller asks directly; the fold never emits
    // them, so they can never be `done` by accident.
    case "orientation_videos":
    case "live_orientation":
    case "handbook":
      return { done: false, inFlight: false };
  }
}

/** Steps 1–9 green, measured over everything in that range — including what cannot be measured. */
function readiness(
  steps: readonly HiringStep[],
  inRange: (spec: HiringStepSpec) => boolean,
): HiringReadiness {
  const done = new Set(steps.filter((s) => s.state === "done").map((s) => s.key));
  const unmeasured: HiringStepKey[] = [];
  const outstanding: HiringStepKey[] = [];
  for (const spec of HIRING_STEPS) {
    if (!inRange(spec)) continue;
    if (spec.evidence === null) unmeasured.push(spec.key);
    else if (!done.has(spec.key)) outstanding.push(spec.key);
  }
  return { ok: unmeasured.length === 0 && outstanding.length === 0, unmeasured, outstanding };
}

export function hiringChecklist(input: HiringChecklistInputs): HiringChecklist {
  const steps: HiringStep[] = [];
  const done = new Set<HiringStepKey>();

  // One pass in D-HM9's order, so a step's requirements are always already decided when it is read.
  for (const spec of measurableHiringSteps()) {
    const evidence = evidenceFor(spec.key, input);
    if (evidence.done) done.add(spec.key);

    // ⚠ A requirement that is not MEASURABLE cannot block: `orientation_videos` has no table, and a
    // step waiting on it would be permanently blocked by something that can never complete. The
    // summary carries that gap instead, as `unmeasured`, where it is visible rather than disabling.
    const blockedBy =
      spec.requires.find((r) => {
        const req = HIRING_STEPS.find((s) => s.key === r);
        return req?.evidence !== null && !done.has(r);
      }) ?? null;

    let state: HiringStepState;
    if (evidence.done) state = "done";
    else if (blockedBy) state = "blocked";
    else if (evidence.inFlight) state = "waiting_on_them";
    else state = spec.owes === "us" ? "waiting_on_us" : "waiting_on_them";

    steps.push({
      ...spec,
      state,
      artifact: evidence.done ? spec.evidence : null,
      blockedBy: state === "blocked" ? blockedBy : null,
    });
  }

  // The one action to lead with (the mockup's "Next: order the MVR"): the first step in D-HM9's own
  // order that is neither done nor waiting on a predecessor.
  //
  // ⚠ **Not "the first thing the office owes", which is what this did first and it was wrong in a
  // way worth keeping written down.** The Clearinghouse query has no in-product prerequisite — its
  // consent is given in FMCSA's portal — so "the office's own move first" nominated *run the
  // Clearinghouse query* for an applicant who had been sent a link and had signed nothing. That is a
  // query the carrier pays for, against a §382.701(a) gate, on somebody who may never apply. The
  // process order already encodes when a step is worth doing; reading it is both simpler and the
  // only one of the two that cannot recommend spending money on a stranger.
  const next = steps.find((s) => s.state !== "done" && s.state !== "blocked")?.key ?? null;

  return {
    steps,
    done: steps.filter((s) => s.state === "done").length,
    total: steps.length,
    readyToTravel: readiness(steps, (s) => s.beforeTravel),
    readyToHire: readiness(steps, (s) => s.key !== "hired"),
    next,
  };
}
