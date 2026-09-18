import { describe, it, expect } from "vitest";
import { hiringChecklist, type HiringChecklistInputs } from "./hiringChecklist.js";
import { HIRING_STEPS, measurableHiringSteps, type HiringStepKey } from "./hiringSteps.js";
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
      reviewRequestedAt: "2026-09-02T00:00:00Z",
      approvedAt: "2026-09-03T00:00:00Z",
      submittedAt: null,
    },
    authorizations: ALL_PERMISSIONS,
    qualificationKinds: ALL_KINDS,
    psp: { requested: true, reportReceived: true },
    packetMarks: packetDriverMarkCount(),
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

  /** ⚠ The array's order IS the checklist's order (D-HM3). Nothing sorts it at read time. */
  it("keeps D-HM9's order, with the medical certificate at 8b", () => {
    const c = hiringChecklist(complete());
    expect(c.steps.map((s) => s.ordinal)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "8b", "10", "13", "14",
    ]);
  });

  /**
   * ⚠ The six §5 gates, named here so that deleting one from the catalogue fails a test rather than
   * quietly shortening the law.
   */
  it("marks exactly the six federal gates", () => {
    expect(HIRING_STEPS.filter((s) => s.federalGate).map((s) => s.key)).toEqual([
      "application_filled", "mvr", "clearinghouse", "drug_test",
      "medical_certificate", "road_test",
    ]);
  });

  /** The seam D-HM9 organises everything around: 1–9 before the plane ticket, 10–14 in the office. */
  it("puts the travel seam after step 9", () => {
    const before = HIRING_STEPS.filter((s) => s.beforeTravel).map((s) => s.ordinal);
    expect(before).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "8b", "9"]);
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
    expect(mvr.artifact).toBe("qualification_records.mvr");
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
    // The clearinghouse consent is NOT among them, and adding it changes nothing.
    expect(APPLICATION_RELEASE_ORDER).not.toContain("clearinghouse");
  });

  /** ⚠ `filling` is not `filled`, however much has been typed. The office has to have received it. */
  it("does not call a half-typed application filled in", () => {
    const c = hiringChecklist(input({
      invitedAt: "2026-09-01T00:00:00Z",
      authorizations: [...ALL_PERMISSIONS],
      phases: { reviewRequestedAt: null, approvedAt: null, submittedAt: null },
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
      phases: { reviewRequestedAt: "2026-09-02T00:00:00Z", approvedAt: null, submittedAt: null },
    }));
    expect(stateOf(c, "office_approved")).toBe("waiting_on_us");
    expect(c.next).toBe("office_approved");
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
