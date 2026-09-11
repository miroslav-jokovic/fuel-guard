import { describe, it, expect } from "vitest";
import { applicantProgress, APPLICANT_STAGES, type ApplicantInputs } from "./applicantPipeline.js";
import type { AuthorizationRow } from "./authorizationContract.js";
import type { ApplicationPhases } from "./applicationReviewContract.js";

const auth = (purpose: string, over: Partial<AuthorizationRow> = {}): AuthorizationRow => ({
  id: over.id ?? `${purpose}-1`,
  purpose,
  accepted_at: over.accepted_at ?? "2026-01-01T00:00:00Z",
  revokes: over.revokes ?? null,
});

const ALL_RELEASES = [auth("fcra_disclosure"), auth("psp"), auth("previous_employer")];

const input = (over: Partial<ApplicantInputs> = {}): ApplicantInputs => ({
  employerCount: over.employerCount ?? 1,
  gapDays: over.gapDays ?? 0,
  authorizations: over.authorizations ?? [],
  // ⚠ Spread LAST, so the two fields added in F5 reach the function. Building the object field by
  // field silently dropped them, and every new test passed by agreeing with the old behaviour.
  ...over,
});

describe("applicantProgress — derived, never stored", () => {
  it("starts at not_started with everything outstanding", () => {
    const p = applicantProgress(input({ employerCount: 0 }));
    expect(p.stage).toBe("not_started");
    expect(p.outstanding).toEqual([
      "employment_history",
      "fcra_disclosure",
      "psp",
      "previous_employer",
    ]);
    expect(p.releasesComplete).toBe(false);
  });

  it("moves to awaiting_releases once employment is declared", () => {
    const p = applicantProgress(input({ employerCount: 2 }));
    expect(p.stage).toBe("awaiting_releases");
    expect(p.outstanding).not.toContain("employment_history");
  });

  /**
   * A gap is not a chase item. The applicant answered the question; the answer needs a conversation.
   * Putting it on the outstanding list would tell a recruiter to go and collect a document that does
   * not exist.
   */
  it("names history_incomplete from a gap without ever listing the gap as outstanding", () => {
    const p = applicantProgress(input({ employerCount: 2, gapDays: 120 }));
    expect(p.stage).toBe("history_incomplete");
    expect(p.outstanding).not.toContain("employment_history");
  });

  it("reaches ready_to_screen only when every release is in hand", () => {
    const partial = applicantProgress(input({ authorizations: [auth("psp")] }));
    expect(partial.stage).toBe("awaiting_releases");
    expect(partial.outstanding).toEqual(["fcra_disclosure", "previous_employer"]);

    const complete = applicantProgress(input({ authorizations: ALL_RELEASES }));
    expect(complete.stage).toBe("ready_to_screen");
    expect(complete.outstanding).toEqual([]);
    expect(complete.releasesComplete).toBe(true);
  });

  /** Derived means derived: revoking a release moves the applicant back, with no column to update. */
  it("falls back out of ready_to_screen the moment a release is revoked", () => {
    const revoked = [...ALL_RELEASES, auth("psp", { id: "r", revokes: "psp-1" })];
    const p = applicantProgress(input({ authorizations: revoked }));
    expect(p.stage).toBe("awaiting_releases");
    expect(p.outstanding).toEqual(["psp"]);
  });

  it("still shows a gap even when the paperwork is complete — both are true at once", () => {
    const p = applicantProgress(input({ gapDays: 90, authorizations: ALL_RELEASES }));
    expect(p.stage).toBe("history_incomplete");
    expect(p.releasesComplete).toBe(true);
  });

  it("orders the stages the way a recruiter works", () => {
    // ⚠ The three in the middle were added 2026-09-11 and belong exactly there: they are what happens
    // between "we invited them" and "we have their file", and until then every one of them read as
    // "Not started" because nothing staff-facing looked at the draft.
    expect(APPLICANT_STAGES).toEqual([
      "not_started",
      "filling_in",
      "awaiting_review",
      "awaiting_signature",
      "history_incomplete",
      "awaiting_releases",
      "ready_to_screen",
    ]);
  });
});

/**
 * Where the application itself has got to, before it is filed (F5).
 *
 * ⚠ This is the defect the owner met by filling in their own test application: they were told
 * **"Not started"** on a form they were half-way through. Everything below the application stages is
 * derived from `driver_employment_history`, and that table is written only at SUBMISSION — so for
 * every driver still typing, the only honest answer came from a place nothing was looking: the draft.
 */
describe("the stages before an application is filed", () => {
  const phases = (over: Partial<ApplicationPhases> = {}): ApplicationPhases => ({
    reviewRequestedAt: null,
    approvedAt: null,
    submittedAt: null,
    ...over,
  });

  it("⚠ says they are filling it in, rather than that nothing has happened", () => {
    const p = applicantProgress(input({ application: phases(), hasDraft: true }));
    expect(p.stage).toBe("filling_in");
  });

  it("keeps 'not started' for a link nobody has opened", () => {
    const p = applicantProgress(input({ employerCount: 0, application: phases(), hasDraft: false }));
    expect(p.stage).toBe("not_started");
  });

  it("names the one stage where the CARRIER owes the next move", () => {
    const p = applicantProgress(input({
      application: phases({ reviewRequestedAt: "2026-09-10T09:00:00Z" }),
      hasDraft: true,
    }));
    expect(p.stage).toBe("awaiting_review");
  });

  it("and the one where the driver does", () => {
    const p = applicantProgress(input({
      application: phases({ reviewRequestedAt: "2026-09-10T09:00:00Z", approvedAt: "2026-09-11T09:00:00Z" }),
      hasDraft: true,
    }));
    expect(p.stage).toBe("awaiting_signature");
  });

  it("⚠ hands back to the FILE once it is certified, rather than staying a stage of its own", () => {
    // After submission the employment rows exist, and what a recruiter needs to know is what the file
    // is missing — not that an application was once signed.
    const p = applicantProgress(input({
      employerCount: 2,
      gapDays: 90,
      application: phases({
        reviewRequestedAt: "2026-09-10T09:00:00Z",
        approvedAt: "2026-09-11T09:00:00Z",
        submittedAt: "2026-09-11T10:00:00Z",
      }),
      hasDraft: true,
    }));
    expect(p.stage).toBe("history_incomplete");
  });

  it("behaves exactly as before for an applicant with no invitation at all", () => {
    // Every caller predating the application system passes neither field.
    expect(applicantProgress(input({ employerCount: 0 })).stage).toBe("not_started");
    expect(applicantProgress(input({ employerCount: 2, gapDays: 0 })).stage).toBe("awaiting_releases");
  });
});
