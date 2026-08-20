import { describe, it, expect } from "vitest";
import { applicantProgress, APPLICANT_STAGES, type ApplicantInputs } from "./applicantPipeline.js";
import type { AuthorizationRow } from "./authorizationContract.js";

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
    expect(APPLICANT_STAGES).toEqual([
      "not_started",
      "history_incomplete",
      "awaiting_releases",
      "ready_to_screen",
    ]);
  });
});
