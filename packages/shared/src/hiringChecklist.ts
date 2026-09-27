import { hasLiveAuthorization, type AuthorizationPurpose } from "./authorizationContract.js";
import { APPLICATION_RELEASE_ORDER } from "./applicationIntake.js";
import { applicationReviewState } from "./applicationReviewContract.js";
import type { HiringChecklistInputs } from "./hiringChecklistInputs.js";
import { mvrJurisdictionsOutstanding } from "./mvrJurisdictions.js";
import { packetDriverMarkCount } from "./packetPlacements.js";
import {
  HIRE_REFUSES_WITHOUT, HIRING_STEPS, TRAVEL_REFUSES_WITHOUT, measurableHiringSteps,
  type HiringEvidence, type HiringStepKey, type HiringStepSpec,
} from "./hiringSteps.js";

// The input's shape lives next door since C2b2 (2026-09-26), split at the 450-line warning along the
// line between what the fold is GIVEN and what it DECIDES; re-exported so no import path changed.
export type { HiringChecklistInputs } from "./hiringChecklistInputs.js";

/**
 * Where a hire has got to, across every step in `HIRING_STEPS` (B1, `HIRING-MODULE-PLAN.md`). The owner
 * named fourteen and the catalogue has grown since — count it there, never restate it here (G-12).
 *
 * ── DERIVED, NEVER STORED (D-HM1) ─────────────────────────────────────────────────────────────
 * This is `applicantPipeline.ts`'s rule at four times the size, and its header says why in words
 * worth repeating: *"A stored stage is a second copy of facts the rows already carry, and it goes
 * stale the moment somebody records an authorization without remembering to advance it."* A
 * checklist of booleans is that failure once per step — and a hiring file whose checklist
 * disagrees with its own evidence is worse than no checklist, because it is a document that gets
 * produced in an audit and contradicted by the file beside it.
 *
 * ⚠ **The corollary is the hard part: a step with no artifact cannot be a step.** The catalogue
 * names every step so that D-HM3's fixed federal order is written down exactly once — but
 * `hiringChecklist()` EMITS only the steps whose evidence exists in the schema today. Some do not
 * (see `evidence: null`), and they are absent from the fold rather than shown as permanently
 * outstanding. A row nobody can ever tick is a decoration, and a decoration on a compliance
 * checklist is a lie with a checkbox.
 *
 * ── AND THE SUMMARY OBEYS THE SAME RULE, WHICH IS THE SUBTLE HALF ─────────────────────────────
 * ⚠ `readyToTravel` cannot be a bare boolean. Until §7 (2026-09-26) the orientation videos were
 * inside its range with no evidence table, so a boolean would have answered "yes, travel" about a
 * person who had watched nothing. They left the range (Q-AW23's default) and `unmeasured` is empty
 * today — but the next unbuilt step placed before travel puts it straight back, which is why the
 * field stays. That is precisely the failure D-HM9 records against itself: the medical certificate was
 * missing for weeks because *capture* had been mistaken for *verification*, and the lesson written
 * down was **"a document being uploaded is not the same fact as a document being verified, and a
 * checklist that conflates them reports a gate as green that nobody has checked."** So both
 * readiness answers carry `unmeasured` — the steps the answer could not see. An empty `unmeasured`
 * is what makes `ok` mean what it says.
 *
 * ── TWO ANSWERS, NOT ONE (D-HM9, owner 2026-09-17) ────────────────────────────────────────────
 * The seam is TRAVEL. Screening happens before the applicant gets on a plane; the road test onwards
 * happens while they are standing in the office. So the fold answers two questions on two different days —
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
  /**
   * The declared licensing jurisdictions with no MVR on file yet, as the applicant wrote them (AF7).
   * Only the `mvr` step ever fills it, and only while it is not done — *"Still needed from: …"*.
   */
  outstandingJurisdictions: string[];
  /**
   * Permissions the link will never ask for again, so only the office's paper door can record them
   * (APPLICATION-FLOW-V2-PLAN.md A-4). Only `permissions_signed` fills it, and only when the applicant's
   * permission ceremony is CLOSED (`releasesCompletedAt`) with purposes still missing — both production
   * applicants mid-flight on 2026-09-26 closed theirs at four, before D-AF4 added `mvr` and
   * `clearinghouse`, and the row read "waiting on them" about a screen they will never see again.
   */
  paperOnlyPurposes: AuthorizationPurpose[];
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
  /** Every `beforeTravel` step: the gate on the plane ticket, the list `TRAVEL_REFUSES_WITHOUT` refuses on. */
  readyToTravel: HiringReadiness;
  /** `HIRE_REFUSES_WITHOUT`: the gate on the hire itself, the list `hireApplicant` refuses on. */
  readyToHire: HiringReadiness;
  /**
   * Steps in the owner's process that nothing in the schema can prove yet — the orientation videos and
   * day (D3, D4) — so the fold never emits them. Named so a surface can say "not built yet" rather
   * than let them vanish (§7, Q-AW23's default); in neither readiness answer's range.
   */
  unbuilt: HiringStepKey[];
  /** The one action to lead with — the office's own first, because that is what it can do today. */
  next: HiringStepKey | null;
}

/**
 * Does a `road_test` record prove a PASS (APPLICATION-FLOW-V2-PLAN.md A-8)?
 *
 * The ceremony (RT3, `roadTest.ts`) writes a record ONLY on a pass and stamps `detail.source =
 * 'road_test'`, so its rows count. Any other row counts only if it says `passed: true` — until
 * 2026-09-26 the DQ page's generic writer took a free-text `result`, so a FAILED test recorded there
 * turned the step green. That door now refuses `road_test` (A-9, `CEREMONY_OWNED_KINDS`); this rule
 * keeps any row it wrote before from counting. Production held 0 such rows on 2026-09-26.
 */
export function roadTestCounts(detail: { source?: string | null; passed?: string | boolean | null }): boolean {
  return detail.source === "road_test" || detail.passed === true || detail.passed === "true";
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
): { done: boolean; inFlight: boolean; outstandingJurisdictions?: string[]; paperOnlyPurposes?: AuthorizationPurpose[] } {
  const review = input.phases ? applicationReviewState(input.phases) : null;
  switch (key) {
    case "invitation_sent":
      return { done: Boolean(input.invitedAt), inFlight: false };
    case "intake_completed":
      // ⚠ THE LEGACY RULE (APPLICATION-FLOW-V2-PLAN §7, stated there once and applied here once): a
      // link with no Part 1 row predates Part 1, and its identity screen (0365) was its Part 1 — so it
      // is done once the permission ceremony closed or the identity is on the driver's row. Measured
      // 2026-09-26: of the eight production invitations, the two mid-flight (`d61557dc`, `f2b142e4`)
      // read done on the first half and the six that never started read waiting on them.
      //
      // ⚠ Only for somebody INVITED. The identity half is a fact about the driver, not the link, so
      // without this an applicant nobody has invited — or a roster driver being re-hired, whose row has
      // held a licence for years — read "Part 1 finished" for a link that does not exist (found by
      // `applicantChecklist.test.ts`'s uninvited case on 2026-09-26).
      if (!input.intake?.v2) {
        const legacyDone = Boolean(input.releasesCompletedAt) || input.identityOnFile === true;
        return { done: Boolean(input.invitedAt) && legacyDone, inFlight: false };
      }
      // A v2 link: done on `complete_applicant_intake`'s stamp, and in flight from the first answer —
      // the row exists only once the applicant has begun (C2a's `record_applicant_intake`).
      return { done: Boolean(input.intake.completedAt), inFlight: true };
    case "permissions_signed":
      // ⚠ Every one the applicant is ASKED for, from `APPLICATION_RELEASE_ORDER` rather than from
      // `AUTHORIZATION_PURPOSES`. Since D-AF4 (2026-09-24) the two lists hold the same five, but the
      // catalogue may grow a purpose no applicant signs, and reading it would hold this step open
      // for ever. ⚠ An applicant who signed the four before D-AF4 reads NOT done until the office
      // records the Clearinghouse limited-query consent (`POST /authorizations`, wet signature).
      // ⚠ A-4: once the link's ceremony is closed, a missing purpose is not "sent, not returned" — the
      // applicant will never be shown it again — so it is the office's, on the paper door.
      {
        const missing = APPLICATION_RELEASE_ORDER.filter((p) => !hasLiveAuthorization(input.authorizations ?? [], p));
        const paperOnly = missing.length > 0 && Boolean(input.releasesCompletedAt);
        return {
          done: missing.length === 0,
          inFlight: !paperOnly && (input.authorizations ?? []).length > 0,
          paperOnlyPurposes: paperOnly ? missing : [],
        };
      }
    case "application_sent":
      // 0365's stamp, set the first time the office presses Send (AF4). Backfilled for everybody who
      // was already past their permissions on 2026-09-24, because the old order opened the form then.
      return { done: Boolean(input.phases?.applicationSentAt), inFlight: false };
    case "application_filled":
      // Sent to the office, or anything after that. `filling` is not done, however much is typed.
      return {
        done: review !== null && review !== "filling",
        inFlight: input.hasDraft === true,
      };
    case "office_approved":
      return { done: review === "approved" || review === "certified", inFlight: false };
    case "mvr": {
      // ⚠ §391.23(a)(1): one record per state that licensed the driver, not one record (AF7). Before
      // anything is declared the list is empty and the rule is what it always was — one MVR. An MVR
      // recorded without a jurisdiction covers no declared state; `mvrJurisdictions.ts` says why.
      // ⚠ G-3: only an MVR dated on or after `mvrFreshSince` is evidence for THIS application; an older
      // one neither ticks the step nor covers a state, so its state is named as still needed.
      const floor = input.mvrFreshSince ?? null;
      const fresh = input.mvrs?.filter((m) => floor === null || m.occurredOn >= floor);
      const outstanding = mvrJurisdictionsOutstanding(
        input.licenceJurisdictions ?? [],
        (fresh ?? []).map((m) => m.jurisdiction),
      );
      return {
        done: (fresh ? fresh.length > 0 : hasKind(input, "mvr")) && outstanding.length === 0,
        inFlight: false,
        outstandingJurisdictions: outstanding,
      };
    }
    case "psp":
      // ⚠ Done is the REPORT, not the request. A request that was billed and came back empty is a
      // request, and §5 calls PSP a tool rather than a requirement — so this is the one step where
      // "we have asked" is a real, visible middle state instead of a silent nothing.
      return {
        done: input.psp?.reportReceived === true,
        inFlight: input.psp?.requested === true,
      };
    case "clearinghouse":
      // D-AW5: the full query needs the driver's §382.703 consent, which only the driver can give, in
      // FMCSA's portal. Until the office records seeing it (`clearinghouse_portal_consent`) the next
      // move is theirs — register and consent — and after it, ours: run the query. `requires: []`
      // stays; the order after the drug result is a warning in the drawer, never an edge.
      return {
        done: hasKind(input, "clearinghouse_full"),
        inFlight: !hasKind(input, "clearinghouse_portal_consent"),
      };
    case "drug_test":
      // ⚠ D-AW6's appointment is NOT read here. The step already rests on the driver ("them" — they go
      // to the site), an appointment arranged outside the product is as good as one recorded in it, and
      // the evidence is the result, never the booking. The drawer shows the appointment instead.
      return { done: hasKind(input, "drug_test"), inFlight: false };
    case "medical_certificate":
      return { done: hasKind(input, "medical_registry_verification"), inFlight: false };
    case "road_test":
      // ⚠ `cdl_equivalency` counts, and `dqCatalogue.ts` already says so: §391.51(b)(4) accepts a
      // road test OR the §391.33 licence equivalency. One requirement, two lawful evidences.
      return {
        done: (input.roadTestPassed ?? hasKind(input, "road_test")) || hasKind(input, "cdl_equivalency"),
        inFlight: false,
      };
    case "application_signed":
      // ⚠ Against the DERIVED count, never a stored stamp — `packetDriverMarkCount()` is the whole
      // of 0339's argument for not adding a `packet_signing_completed_at` column that would go stale
      // the next time counsel rules on page 19's duplicate.
      //
      // ⚠ In flight once the office has OPENED signing (AF5, D-AF3), and not on the marks. Marks
      // without an opening exist only from before 0369 — production's 2026-09-17 walk holds twenty —
      // and that packet cannot take another mark until somebody in the office opens it, so reading
      // those marks as "waiting on them" would tell the office to wait for a signer who is refused.
      return {
        done: (input.packetMarks ?? 0) >= packetDriverMarkCount(input.applyingAs ?? null),
        inFlight: Boolean(input.phases?.signingOpenedAt),
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
    case "travel_booked":
      // D-AW7: a live trip. Cancelling one leaves the row (operational, never deleted) and re-opens this.
      return { done: input.travelBooked === true, inFlight: false };
    case "hired":
      return { done: Boolean(input.hiredAt), inFlight: false };
    // The three with no evidence table. Reached only if a caller asks directly; the fold never emits
    // them, so they can never be `done` by accident.
    case "handbook":
      // Done on the filed record (HB3 writes it with the signed PDF), never on the marks: six signed
      // places with no countersignature and no filed document is a handbook in progress. In flight
      // while the office has opened it and the driver has places left — after that the next move is
      // the office's countersignature, so it is ours again.
      return {
        done: hasKind(input, "handbook"),
        inFlight: Boolean(input.handbook?.openedAt) && !input.handbook?.driverComplete,
      };
    case "orientation_videos":
    case "live_orientation":
      return { done: false, inFlight: false };
  }
}

/** Every step in range green, measured over everything in that range — including what cannot be measured. */
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
    else if (evidence.paperOnlyPurposes?.length) state = "waiting_on_us";
    else if (evidence.inFlight) state = "waiting_on_them";
    else state = spec.owes === "us" ? "waiting_on_us" : "waiting_on_them";

    steps.push({
      ...spec,
      state,
      artifact: evidence.done ? spec.evidence : null,
      blockedBy: state === "blocked" ? blockedBy : null,
      outstandingJurisdictions: evidence.done ? [] : (evidence.outstandingJurisdictions ?? []),
      paperOnlyPurposes: evidence.done ? [] : (evidence.paperOnlyPurposes ?? []),
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
    // ⚠ G-11: the ONE definition — what the hire refuses without. This read every step but `hired`
    // until 2026-09-26, which put the unbuilt orientation rows in range, so `ok` could never be true
    // for anybody; it had no caller, and the hire refused on a different list.
    readyToHire: readiness(steps, (s) => HIRE_REFUSES_WITHOUT.includes(s.key)),
    unbuilt: HIRING_STEPS.filter((s) => s.evidence === null).map((s) => s.key),
    next,
  };
}

/**
 * The steps a hire is refused for, in the catalogue's order — empty when it may proceed.
 *
 * ⚠ Fail-closed: a refusing step the fold did not emit counts as missing, never as done — for
 * `readiness()`'s reason, that an absence of evidence is not evidence of completeness.
 */
export function hireBlockers(checklist: Pick<HiringChecklist, "steps">): HiringStepKey[] {
  return notDone(checklist, HIRE_REFUSES_WITHOUT);
}

/** The steps recording the trip is refused for (D-AW7) — `hireBlockers`' rule, over the travel list. */
export function travelBlockers(checklist: Pick<HiringChecklist, "steps">): HiringStepKey[] {
  return notDone(checklist, TRAVEL_REFUSES_WITHOUT);
}

function notDone(checklist: Pick<HiringChecklist, "steps">, list: readonly HiringStepKey[]): HiringStepKey[] {
  const done = new Set(checklist.steps.filter((s) => s.state === "done").map((s) => s.key));
  return list.filter((key) => !done.has(key));
}
