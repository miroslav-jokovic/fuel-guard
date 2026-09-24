import { describe, it, expect } from "vitest";
import { hiringChecklist, type HiringChecklistInputs } from "./hiringChecklist.js";
import {
  HIRING_PHASE_LABELS,
  HIRING_STEPS,
  hiringStep,
  measurableHiringSteps,
  type HiringStepKey,
} from "./hiringSteps.js";
import { APPLICATION_RELEASE_ORDER } from "./applicationIntake.js";
import type { AuthorizationRow } from "./authorizationContract.js";
import { packetDriverMarkCount } from "./packetPlacements.js";

/**
 * The fold behind the whole hiring module (B1, `HIRING-MODULE-PLAN.md` §9).
 *
 * ⚠ **The fixtures are built from the REAL catalogues, not from hand-written pairs.**
 * `APPLICATION_RELEASE_ORDER` is what an applicant is actually asked to sign and
 * `packetDriverMarkCount()` is what the packet actually takes — both have changed in this repo and
 * both will again. A fixture that wrote "4" and "22" would keep passing through the change it exists
 * to catch, which is this repo's named failure mode: a fixture too uniform to discriminate.
 */

const auth = (purpose: string): AuthorizationRow => ({
  id: `${purpose}-1`,
  purpose,
  accepted_at: "2026-09-01T00:00:00Z",
  revokes: null,
});

const ALL_PERMISSIONS = APPLICATION_RELEASE_ORDER.map((p) => auth(p));

/** Every kind the measurable screening steps read, so a fixture can turn them on one at a time. */
const ALL_KINDS = [
  "mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "road_test",
];

const input = (over: Partial<HiringChecklistInputs> = {}): HiringChecklistInputs => ({ ...over });

/** An applicant who has done everything the schema can see. The baseline the state tests peel back. */
const complete = (over: Partial<HiringChecklistInputs> = {}): HiringChecklistInputs =>
  input({
    invitedAt: "2026-09-01T00:00:00Z",
    phases: {
      applicationSentAt: "2026-09-01T12:00:00Z",
      reviewRequestedAt: "2026-09-02T00:00:00Z",
      approvedAt: "2026-09-03T00:00:00Z",
      signingOpenedAt: "2026-09-08T00:00:00Z",
      submittedAt: null,
    },
    authorizations: ALL_PERMISSIONS,
    qualificationKinds: ALL_KINDS,
    psp: { requested: true, reportReceived: true },
    packetMarks: packetDriverMarkCount(),
    // ⚠ Q-HM9. Nothing outstanding, so nothing can be awaiting either — `awaiting` counts a SUBSET of
    // `outstanding`, and a fixture with `awaiting > outstanding` would be describing a state the
    // queue cannot produce.
    investigation: { outstanding: 0, awaiting: 0 },
    hiredAt: "2026-09-10",
    ...over,
  });

const stateOf = (c: ReturnType<typeof hiringChecklist>, key: HiringStepKey) =>
  c.steps.find((s) => s.key === key)?.state;

describe("the catalogue", () => {
  /**
   * ⚠ D-HM1's corollary, and the assertion this whole file exists to protect: *a step with no
   * artifact cannot be a step.* Three steps have no evidence table in this schema — the orientation
   * videos, the live orientation day and the handbook — and none of them may appear in the fold as a
   * row somebody could tick. A checklist that shows a row nothing can ever satisfy is a decoration.
   */
  it("refuses to emit a step whose evidence table does not exist", () => {
    const c = hiringChecklist(complete());
    const emitted = c.steps.map((s) => s.key);
    expect(emitted).not.toContain("orientation_videos");
    expect(emitted).not.toContain("live_orientation");
    expect(emitted).not.toContain("handbook");
    // And the catalogue still NAMES all of them, so the order is written down exactly once.
    expect(HIRING_STEPS.map((s) => s.key)).toContain("orientation_videos");
    expect(HIRING_STEPS.length).toBe(measurableHiringSteps().length + 3);
  });

  /**
   * ⚠ The array's order IS the checklist's order (D-HM3). Nothing sorts it at read time.
   *
   * ⚠ The owner's order since 2026-09-24 (`APPLICANT-FLOW-PLAN.md` §3.3, D-AF1..3), superseding
   * D-HM9's: the permissions, then SCREENING, then the application is sent, filled and approved, and
   * the packet is signed in the office. Asserted by KEY, because the order is the claim; the numbers
   * are asserted separately below as what they are — a count from one.
   */
  it("keeps the owner's order: permissions, screening, then the application, then the office day", () => {
    const c = hiringChecklist(complete());
    expect(c.steps.map((s) => s.key)).toEqual([
      "invitation_sent", "permissions_signed",
      "mvr", "psp", "clearinghouse", "drug_test",
      "application_sent", "application_filled", "office_approved",
      "medical_certificate", "employment_investigation",
      "road_test", "application_signed", "hired",
    ]);
  });

  it("numbers the catalogue from one, in its own order, with no gaps", () => {
    expect(HIRING_STEPS.map((s) => s.ordinal)).toEqual(HIRING_STEPS.map((_, i) => String(i + 1)));
  });

  /**
   * ⚠ The six §5 gates, named here so that deleting one from the catalogue fails a test rather than
   * quietly shortening the law.
   */
  it("marks exactly the six federal gates", () => {
    expect(HIRING_STEPS.filter((s) => s.federalGate).map((s) => s.key)).toEqual([
      "mvr", "clearinghouse", "drug_test", "application_filled",
      "medical_certificate", "road_test",
    ]);
  });

  /**
   * The seam D-HM9 organises everything around: what must be done before the plane ticket.
   *
   * ⚠ The investigation is listed before the videos (plan §3.3) and is still NOT before travel — its
   * clock is the previous employers', and gating the ticket on their silence is Q-HM9's refused case.
   */
  it("puts everything up to the videos before travel, except the investigation", () => {
    const before = HIRING_STEPS.filter((s) => s.beforeTravel).map((s) => s.key);
    expect(before).toEqual([
      "invitation_sent", "permissions_signed", "mvr", "psp", "clearinghouse", "drug_test",
      "application_sent", "application_filled", "office_approved", "medical_certificate",
      "orientation_videos",
    ]);
  });

  /**
   * ⚠ Every step carries a phase and an ACTION, and the action is never the label (B4).
   *
   * Both fields exist because the board asked this catalogue two questions a checklist never asks:
   * *what stage is this* and *what has to happen next*. The second is the one that went wrong in
   * the only way a type cannot catch — a step whose action is its label renders "Next action:
   * Office approved it", a completed fact where an instruction belongs. That shipped, was green,
   * and was found by looking at the board at 1440 on 2026-09-18.
   */
  it("gives every step a phase, and an action that is not its label", () => {
    for (const step of HIRING_STEPS) {
      expect(HIRING_PHASE_LABELS[step.phase], `${step.key} has no phase label`).toBeTruthy();
      expect(step.action.length, `${step.key} has no action`).toBeGreaterThan(0);
      expect(step.action, `${step.key}'s action is its label, so the board reads as a fact`)
        .not.toBe(step.label);
    }
  });

  /** `hiringStep` is total over the union — a miss means the union and the array have drifted. */
  it("resolves every key in the union to a spec", () => {
    for (const step of HIRING_STEPS) expect(hiringStep(step.key)).toBe(step);
  });

  /**
   * ⚠ D-HUI3's third column, checked at the catalogue rather than at the renderer (B5).
   *
   * Until B5 the artifact was `spec.evidence` — a bare table name — so *"qualification_records.mvr"*
   * was what a recruiter's screen said the proof was. The fix belongs here and not in a map beside
   * the component, because a map is a copy with a delay fuse: nothing fails when a new step is added
   * without an entry. Binding the words to the row means a step cannot have one without the other,
   * and this asserts the half a type cannot — that the words are words, and are not just the step's
   * own label said twice, which would make the column do nothing.
   */
  it("gives every measurable step artifact words that are not the step's own label", () => {
    for (const step of measurableHiringSteps()) {
      const evidence = step.evidence!;
      expect(evidence.label.length, `${step.key} has no artifact words`).toBeGreaterThan(0);
      expect(evidence.label, `${step.key}'s artifact restates its label, so the column says nothing`)
        .not.toBe(step.label);
      // A table name is what this replaced, so it must not have crept back into the words.
      expect(evidence.label, `${step.key}'s artifact is a table name`).not.toContain("_");
    }
  });

  /**
   * ⚠ The table is an ADDRESS as well as a fact, so two steps proved by the same row would give one
   * surface two names for one document. Six of them share `qualification_records`, and each names a
   * different `kind` after the dot for exactly this reason.
   */
  it("proves each measurable step with a row no other step claims", () => {
    const tables = measurableHiringSteps().map((s) => s.evidence!.table);
    expect(new Set(tables).size).toBe(tables.length);
  });
});

describe("the four states", () => {
  it("is waiting_on_us at the very start — nobody has been invited", () => {
    const c = hiringChecklist(input());
    expect(stateOf(c, "invitation_sent")).toBe("waiting_on_us");
    expect(c.next).toBe("invitation_sent");
    expect(c.done).toBe(0);
  });

  it("is waiting_on_them once the link is out and the applicant has signed nothing", () => {
    const c = hiringChecklist(input({ invitedAt: "2026-09-01T00:00:00Z" }));
    expect(stateOf(c, "invitation_sent")).toBe("done");
    expect(stateOf(c, "permissions_signed")).toBe("waiting_on_them");
  });

  /** ⚠ A blocked row names its blocker in words, never a greyed row with no explanation. */
  it("is blocked, and says by what", () => {
    const c = hiringChecklist(input({ invitedAt: "2026-09-01T00:00:00Z" }));
    const mvr = c.steps.find((s) => s.key === "mvr")!;
    expect(mvr.state).toBe("blocked");
    expect(mvr.blockedBy).toBe("permissions_signed");
  });

  it("is done when the evidence exists, and carries the artifact that proves it", () => {
    const c = hiringChecklist(complete());
    const mvr = c.steps.find((s) => s.key === "mvr")!;
    expect(mvr.state).toBe("done");
    expect(mvr.artifact).toEqual({ table: "qualification_records.mvr", label: "MVR report" });
  });

  /**
   * ⚠ The artifact column is the visible half of D-HM1's corollary, so it must be empty until the
   * proof exists — showing the table name early would be showing where the proof WOULD live.
   */
  it("carries no artifact before the step is done", () => {
    const c = hiringChecklist(input({ invitedAt: "2026-09-01T00:00:00Z" }));
    expect(c.steps.find((s) => s.key === "permissions_signed")!.artifact).toBeNull();
  });
});

/**
 * Q-HM9 — the §391.23(a)(2) previous-employer investigation (ruled 2026-09-18).
 *
 * ⚠ The whole reason this step exists is that a recruiter working the checklist alone could reach
 * "Hired" with a §391.51(b)(3) file requirement untouched. So the assertion that carries the ruling
 * is the LAST one in this block — `hired` is blocked by it — and everything above it exists to make
 * sure the step cannot go green dishonestly first.
 */
describe("the §391.23 investigation", () => {
  /** With the history declared and every owed employer closed out, there is nothing left to ask. */
  it("is done when nothing is outstanding and the application has been filed", () => {
    const c = hiringChecklist(complete());
    const step = c.steps.find((s) => s.key === "employment_investigation")!;
    expect(step.state).toBe("done");
    expect(step.artifact).toEqual({ table: "employer_inquiries", label: "Inquiry record" });
  });

  /**
   * ⚠ **THE DEFECT THIS STEP WAS MOST LIKELY TO SHIP, pinned.**
   *
   * `driverInquiryQueue.complete` is `outstanding.length === 0`, which is vacuously TRUE for a driver
   * whose employment history nobody has typed yet: no employers owed, nothing outstanding. A step
   * reading that number alone goes green on the day the invitation is sent, certifying an
   * investigation that has not begun — D-HM9's own medical-certificate mistake (capture read as
   * verification) in a third costume.
   *
   * Here the application is still `filling` and the queue is empty, which is exactly that shape.
   */
  it("refuses to be done on an empty queue when the application has not been filed", () => {
    const c = hiringChecklist(
      complete({
        phases: { applicationSentAt: "2026-09-01T12:00:00Z", reviewRequestedAt: null, approvedAt: null, signingOpenedAt: null, submittedAt: null },
        investigation: { outstanding: 0, awaiting: 0 },
      }),
    );
    expect(stateOf(c, "employment_investigation")).not.toBe("done");
  });

  /**
   * ⚠ And the other half of that rule, which is what stops the fix above becoming its own defect: a
   * first-time driver with no DOT-regulated employer inside the three-year window genuinely has
   * nobody to write to. Once the history is DECLARED, zero means zero, and holding them against a row
   * nothing can ever satisfy would be the decoration D-HM1's corollary forbids.
   */
  it("is done for a declared history with no DOT-regulated employer to ask", () => {
    const c = hiringChecklist(complete({ investigation: { outstanding: 0, awaiting: 0 } }));
    expect(stateOf(c, "employment_investigation")).toBe("done");
  });

  /** ⚠ Absent input is NOT DONE — a caller that forgets the read leaves the step visibly open. */
  it("is not done when the caller supplies no investigation at all", () => {
    const c = hiringChecklist(complete({ investigation: null }));
    expect(stateOf(c, "employment_investigation")).not.toBe("done");
  });

  /**
   * ⚠ Nobody written to is OURS to move; written and unanswered is THEIRS — the previous employer's,
   * exactly as PSP's is the vendor's once an order is placed. The distinction is D-HUI4's between
   * chasing and acting, and it is the difference between a row that says "send the letters" and one
   * that says "they have not written back".
   */
  it("owes us the first letter and them the reply", () => {
    const notSent = hiringChecklist(complete({ investigation: { outstanding: 2, awaiting: 0 } }));
    expect(stateOf(notSent, "employment_investigation")).toBe("waiting_on_us");

    const sent = hiringChecklist(complete({ investigation: { outstanding: 2, awaiting: 2 } }));
    expect(stateOf(sent, "employment_investigation")).toBe("waiting_on_them");
  });

  /**
   * ⚠ **THE DEFECT THE BROWSER FOUND, pinned** (2026-09-18, rendered at 1440).
   *
   * Two employers outstanding and one letter sent. The first version of this rule read "has anything
   * been sent at all", so the row said ***"Waiting on them"*** while the office had not written to
   * one of the two — telling a recruiter to sit still when the next move was theirs. Every test was
   * green for it, because none of them held a PARTIAL state: the fixtures were all-or-nothing, which
   * is this repo's named "fixture too uniform to discriminate" failure.
   *
   * `awaiting` counts only the employers whose own §391.23(g)(1) 30 days are still running. One
   * `not_sent`, `overdue` or `undeliverable` among them and it is ours.
   */
  it("is ours while ANY outstanding employer has not been written to", () => {
    const c = hiringChecklist(complete({ investigation: { outstanding: 2, awaiting: 1 } }));
    expect(stateOf(c, "employment_investigation")).toBe("waiting_on_us");
  });

  /** ⚠ The work can start the moment the application declares a history, and not before. */
  it("is blocked by the application, and says so", () => {
    const c = hiringChecklist(input({ invitedAt: "2026-09-01T00:00:00Z" }));
    const step = c.steps.find((s) => s.key === "employment_investigation")!;
    expect(step.state).toBe("blocked");
    expect(step.blockedBy).toBe("application_filled");
  });

  /**
   * ⚠ **THE RULING.** Everything else in this block protects this one assertion: an outstanding
   * investigation blocks the hire, so nobody reaches the end of the checklist with §391.23 untouched.
   */
  it("blocks the hire while an employer is still outstanding", () => {
    // ⚠ `hiredAt: null` is the scenario, not a convenience. The fold lets EVIDENCE beat `blocked` —
    // a driver with a `hire_date` reads `done` whatever the requirements say, because the checklist
    // reports what happened rather than what should have. So the row Q-HM9 exists to protect is the
    // one before the hire, which is the only moment anybody can still act on it.
    const c = hiringChecklist(
      complete({ hiredAt: null, investigation: { outstanding: 1, awaiting: 1 } }),
    );
    const hired = c.steps.find((s) => s.key === "hired")!;
    expect(hired.state).toBe("blocked");
    expect(hired.blockedBy).toBe("employment_investigation");
    expect(c.readyToHire.ok).toBe(false);
    expect(c.readyToHire.outstanding).toContain("employment_investigation");
  });

  /**
   * ⚠ And it does NOT gate the plane ticket. §391.23(c)(1) gives the carrier 30 days from the date
   * employment begins, so gating travel on it would stall a hire for a third party's silence — or
   * push an office to document a non-response early just to clear the row, which produces a weaker
   * file than waiting. See the step's own row for the argument.
   */
  it("does not hold up travel", () => {
    const c = hiringChecklist(complete({ investigation: { outstanding: 3, awaiting: 0 } }));
    expect(c.readyToTravel.outstanding).not.toContain("employment_investigation");
  });
});

describe("what each step actually reads", () => {
  /**
   * ⚠ Four, from `APPLICATION_RELEASE_ORDER` and not from `AUTHORIZATION_PURPOSES`. The fifth
   * purpose, `clearinghouse`, is signed inside FMCSA's portal and no applicant ever sees it here
   * (D-REC4) — reading the wrong list would hold this step open for every applicant, for ever.
   */
  it("needs every permission the applicant is asked for, and not the one they are not", () => {
    const partial = ALL_PERMISSIONS.slice(0, -1);
    const c = hiringChecklist(input({ invitedAt: "2026-09-01T00:00:00Z", authorizations: partial }));
    expect(stateOf(c, "permissions_signed")).toBe("waiting_on_them");

    const all = hiringChecklist(input({ invitedAt: "2026-09-01T00:00:00Z", authorizations: [...ALL_PERMISSIONS] }));
    expect(stateOf(all, "permissions_signed")).toBe("done");
  });

  /**
   * ⚠ D-AF4 (2026-09-24): the Clearinghouse limited-query consent is the fifth permission, so the
   * four an applicant signed before it — the two production walks the plan's cutover names — no
   * longer close the step. The office records the fifth on paper; until then this stays open.
   */
  it("holds the step open for an applicant who signed only the four from before D-AF4", () => {
    const four = ["fcra_disclosure", "psp", "previous_employer", "drug_alcohol"].map((p) => auth(p));
    const c = hiringChecklist(input({ invitedAt: "2026-09-01T00:00:00Z", authorizations: four }));
    expect(stateOf(c, "permissions_signed")).toBe("waiting_on_them");
    expect(APPLICATION_RELEASE_ORDER).toContain("clearinghouse");
  });

  /** ⚠ `filling` is not `filled`, however much has been typed. The office has to have received it. */
  it("does not call a half-typed application filled in", () => {
    const c = hiringChecklist(input({
      invitedAt: "2026-09-01T00:00:00Z",
      authorizations: [...ALL_PERMISSIONS],
      phases: { applicationSentAt: "2026-09-01T12:00:00Z", reviewRequestedAt: null, approvedAt: null, signingOpenedAt: null, submittedAt: null },
      hasDraft: true,
    }));
    expect(stateOf(c, "application_filled")).toBe("waiting_on_them");
  });

  /**
   * ⚠ Against the DERIVED count. 0339 argues at length for not storing a
   * `packet_signing_completed_at` stamp — it would go stale the next time counsel rules on page 19's
   * duplicate — and this is the same argument one layer up.
   */
  it("counts the packet against the inventory, not against a number", () => {
    const short = hiringChecklist(complete({ packetMarks: packetDriverMarkCount() - 1 }));
    expect(stateOf(short, "application_signed")).toBe("waiting_on_them");
    expect(stateOf(hiringChecklist(complete()), "application_signed")).toBe("done");
  });

  /**
   * ⚠ AF5 (D-AF3, 0369): after approval the next move is the OFFICE's — open signing at the desk —
   * and only then does the applicant owe the marks. The third case is production's 2026-09-17 walk:
   * twenty marks from before 0369 and never opened. Reading those marks as "waiting on them" would
   * tell the office to wait for a signer the database refuses.
   */
  it("owes the office the opening, then the applicant the marks", () => {
    const approved = complete().phases!;
    const unopened = { ...approved, signingOpenedAt: null };
    expect(stateOf(hiringChecklist(complete({ phases: unopened, packetMarks: 0 })), "application_signed"))
      .toBe("waiting_on_us");
    expect(stateOf(hiringChecklist(complete({ packetMarks: 0 })), "application_signed")).toBe("waiting_on_them");
    expect(
      stateOf(hiringChecklist(complete({ phases: unopened, packetMarks: packetDriverMarkCount() - 2 })), "application_signed"),
    ).toBe("waiting_on_us");
  });

  /**
   * ⚠ §391.51(b)(4) accepts a road test OR the §391.33 licence equivalency — one requirement with
   * two lawful evidences, which `dqCatalogue.ts` already models and this must not narrow.
   */
  it("accepts the licence equivalency in place of a road test", () => {
    const c = hiringChecklist(complete({
      qualificationKinds: ALL_KINDS.filter((k) => k !== "road_test").concat("cdl_equivalency"),
    }));
    expect(stateOf(c, "road_test")).toBe("done");
  });

  /**
   * ⚠ PSP is the one step with a real middle state: §5 calls it a tool rather than a requirement, so
   * "we have asked and nothing has come back" is a thing to CHASE, not a thing to do.
   */
  it("tells an outstanding PSP request from one never made", () => {
    const base = { invitedAt: "2026-09-01T00:00:00Z", authorizations: [...ALL_PERMISSIONS] };
    const none = hiringChecklist(input(base));
    expect(stateOf(none, "psp")).toBe("waiting_on_us");
    const sent = hiringChecklist(input({ ...base, psp: { requested: true, reportReceived: false } }));
    expect(stateOf(sent, "psp")).toBe("waiting_on_them");
    const back = hiringChecklist(input({ ...base, psp: { requested: true, reportReceived: true } }));
    expect(stateOf(back, "psp")).toBe("done");
  });

  /**
   * ⚠ §5.1, the one genuine contradiction, resolved to the STRICTER reading until counsel rules
   * (Q-HM1 / Q-REC5). FMCSA has said in writing that the Clearinghouse query may follow a road test,
   * so it is deliberately NOT a blocker; the drug-test half is an inference every commercial source
   * draws and no FMCSA document does, and D-REC7's principle is to take the answer that can only be
   * stricter than necessary.
   */
  it("blocks the road test on the drug test, and not on the Clearinghouse query", () => {
    const c = hiringChecklist(complete({
      qualificationKinds: ["mvr", "medical_registry_verification"],
    }));
    const road = c.steps.find((s) => s.key === "road_test")!;
    expect(road.state).toBe("blocked");
    expect(road.blockedBy).toBe("drug_test");

    const noQuery = hiringChecklist(complete({
      qualificationKinds: ALL_KINDS.filter((k) => k !== "clearinghouse_full"),
    }));
    expect(stateOf(noQuery, "road_test")).toBe("done");
  });

  /**
   * ⚠ The Clearinghouse query's consent is given in FMCSA's portal, so nothing we hold gates it —
   * an office with an approved applicant and no signatures at all may still run it.
   */
  it("never blocks the Clearinghouse query on anything we hold", () => {
    const c = hiringChecklist(input());
    expect(stateOf(c, "clearinghouse")).toBe("waiting_on_us");
  });
});

describe("the two readiness answers", () => {
  /**
   * ⚠ **The assertion that keeps this honest.** Step 9 is inside the travel range and has no
   * evidence table, so `readyToTravel.ok` can never be true today — and it says WHY, by name. A bare
   * boolean here would answer "yes, fly him out" about somebody who has watched no videos, which is
   * the medical-certificate mistake (capture read as verification) repeated one level up.
   */
  it("cannot say ready-to-travel while a step in range has no evidence table", () => {
    const c = hiringChecklist(complete());
    expect(c.readyToTravel.outstanding).toEqual([]);
    expect(c.readyToTravel.unmeasured).toEqual(["orientation_videos"]);
    expect(c.readyToTravel.ok).toBe(false);
  });

  it("names what is outstanding, separately from what it cannot see", () => {
    const c = hiringChecklist(complete({ qualificationKinds: ["mvr"] }));
    expect(c.readyToTravel.outstanding).toEqual([
      "clearinghouse", "drug_test", "medical_certificate",
    ]);
    expect(c.readyToTravel.unmeasured).toEqual(["orientation_videos"]);
  });

  /**
   * ⚠ The road test is the only federal gate that cannot be green before arrival, because it
   * physically happens on arrival — so it is in `readyToHire`'s range and out of `readyToTravel`'s.
   */
  it("holds the road test out of the travel answer and inside the hire answer", () => {
    const c = hiringChecklist(complete({
      qualificationKinds: ALL_KINDS.filter((k) => k !== "road_test"),
    }));
    expect(c.readyToTravel.outstanding).toEqual([]);
    expect(c.readyToHire.outstanding).toContain("road_test");
  });

  /** ⚠ Hiring is not one of the things you must do before hiring. */
  it("does not ask the hire to precede itself", () => {
    const c = hiringChecklist(complete({ hiredAt: null }));
    expect(c.readyToHire.outstanding).not.toContain("hired");
  });
});

describe("the one next action", () => {
  /** The first step in D-HM9's order that is neither done nor waiting on a predecessor. */
  it("names the office's move when the application is sitting with the office", () => {
    const c = hiringChecklist(input({
      invitedAt: "2026-09-01T00:00:00Z",
      authorizations: [...ALL_PERMISSIONS],
      // Screening finished, which in the owner's order (plan §3.3) comes before the application.
      qualificationKinds: ["mvr", "clearinghouse_full", "drug_test"],
      psp: { requested: true, reportReceived: true },
      phases: { applicationSentAt: "2026-09-01T12:00:00Z", reviewRequestedAt: "2026-09-02T00:00:00Z", approvedAt: null, signingOpenedAt: null, submittedAt: null },
    }));
    expect(stateOf(c, "office_approved")).toBe("waiting_on_us");
    expect(c.next).toBe("office_approved");
  });

  /**
   * ⚠ AF4 (plan §3.3): screening comes BEFORE the application. An applicant who has signed their
   * permissions is the office's to screen, and the lead action says so — not "send the application",
   * which D-AF5 allows early with a warning but which is not the owner's order.
   */
  it("leads with screening once the permissions are signed, ahead of sending the application", () => {
    const c = hiringChecklist(input({
      invitedAt: "2026-09-01T00:00:00Z",
      authorizations: [...ALL_PERMISSIONS],
      phases: { applicationSentAt: null, reviewRequestedAt: null, approvedAt: null, signingOpenedAt: null, submittedAt: null },
    }));
    expect(c.next).toBe("mvr");
    expect(stateOf(c, "application_sent")).toBe("waiting_on_us");
    // The form is not the applicant's to fill until it is sent: blocked, and it names why.
    expect(stateOf(c, "application_filled")).toBe("blocked");
    expect(c.steps.find((s) => s.key === "application_filled")!.blockedBy).toBe("application_sent");
  });

  /** And the stamp 0365 sets — or backfilled — is what makes it done. */
  it("counts the application as sent from the stamp alone", () => {
    const sent = hiringChecklist(input({
      authorizations: [...ALL_PERMISSIONS],
      phases: { applicationSentAt: "2026-09-05T00:00:00Z", reviewRequestedAt: null, approvedAt: null, signingOpenedAt: null, submittedAt: null },
    }));
    expect(stateOf(sent, "application_sent")).toBe("done");
    expect(stateOf(sent, "application_filled")).toBe("waiting_on_them");
  });

  /**
   * ⚠ **The case that corrected the rule.** `next` was "the first step the OFFICE owes", and because
   * the Clearinghouse query has no in-product prerequisite — its consent is given in FMCSA's portal
   * — that nominated *run the Clearinghouse query* for an applicant who had been sent a link and had
   * signed nothing. A paid query, against a federal gate, on somebody who may never apply.
   */
  it("does not send the office off to buy a Clearinghouse query for a stranger", () => {
    const c = hiringChecklist(input({ invitedAt: "2026-09-01T00:00:00Z" }));
    expect(stateOf(c, "clearinghouse")).toBe("waiting_on_us");
    expect(c.next).toBe("permissions_signed");
  });

  it("has no next action when every measurable step is done", () => {
    const c = hiringChecklist(complete());
    expect(c.next).toBeNull();
    expect(c.done).toBe(c.total);
  });
});

describe("the count", () => {
  /**
   * ⚠ *"The count a driver is watching must not move while they are watching it"* —
   * `usePacketCeremony` learned this, and the checklist inherits it: completed steps stay counted
   * rather than being filtered out, so the denominator never renumbers under somebody.
   */
  it("keeps the denominator fixed as steps complete", () => {
    const empty = hiringChecklist(input());
    const full = hiringChecklist(complete());
    expect(empty.total).toBe(full.total);
    expect(empty.done).toBe(0);
    expect(full.done).toBe(full.total);
  });
});
