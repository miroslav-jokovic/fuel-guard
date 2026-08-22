import { describe, it, expect } from "vitest";
import { STALE_DRAFT_HOURS, planApplicationNudges, type NudgeCandidate } from "./applicationNudge.js";

/**
 * Who gets emailed, and — mostly — who does not (A10).
 *
 * Every rule in this fold is a decision about a stranger's inbox, so each is tested on its own rather
 * than through one happy path. The failure that matters is not "nobody was nudged": it is nudging
 * somebody who finished, somebody whose link the carrier deliberately took away, or somebody twice.
 */

const NOW = "2026-08-21T12:00:00Z";
const hoursAgo = (n: number): string => new Date(Date.parse(NOW) - n * 3_600_000).toISOString();

const candidate = (over: Partial<NudgeCandidate> = {}): NudgeCandidate => ({
  id: "inv-1",
  driver_id: "driver-1",
  email: "susan@example.test",
  expires_at: "2026-09-01T00:00:00Z",
  revoked_at: null,
  submitted_at: null,
  nudged_at: null,
  draft_updated_at: hoursAgo(72),
  furthest_section: "employment",
  ...over,
});

describe("who is nudged", () => {
  it("finds a driver whose draft has sat untouched past the window", () => {
    const [nudge] = planApplicationNudges([candidate()], NOW);
    expect(nudge?.invitationId).toBe("inv-1");
    expect(nudge?.email).toBe("susan@example.test");
    expect(nudge?.furthestSection).toBe("employment");
    // Per invitation, so the office is told once and the six-hourly re-runs stay silent.
    expect(nudge?.dedupeKey).toBe("application_stalled:inv-1");
  });

  it("leaves a draft touched inside the window alone — Friday evening is not abandonment", () => {
    expect(planApplicationNudges([candidate({ draft_updated_at: hoursAgo(STALE_DRAFT_HOURS - 1) })], NOW)).toEqual([]);
  });

  it("leaves an invitation with no draft alone — they opened the link and typed nothing", () => {
    expect(planApplicationNudges([candidate({ draft_updated_at: null })], NOW)).toEqual([]);
  });

  it("never nudges a driver who finished", () => {
    expect(planApplicationNudges([candidate({ submitted_at: "2026-08-20T10:00:00Z" })], NOW)).toEqual([]);
  });

  /** The carrier took the link away. Handing it back would undo a deliberate act. */
  it("never nudges a revoked invitation", () => {
    expect(planApplicationNudges([candidate({ revoked_at: "2026-08-20T10:00:00Z" })], NOW)).toEqual([]);
  });

  /** A nudge extends a live link; it does not resurrect a dead one. */
  it("never nudges an expired invitation", () => {
    expect(planApplicationNudges([candidate({ expires_at: "2026-08-01T00:00:00Z" })], NOW)).toEqual([]);
  });

  /** Once, ever. A system that reminds an applicant every six hours gets filtered. */
  it("never nudges twice", () => {
    expect(planApplicationNudges([candidate({ nudged_at: "2026-08-20T10:00:00Z" })], NOW)).toEqual([]);
  });
});

describe("what the office is told", () => {
  /**
   * An invitation with no address still surfaces. The office alert is the cue to pick up the phone,
   * and the caller is what declines to stamp `nudged_at` for it — spending the one nudge on an email
   * nobody could receive is the failure this shape avoids.
   */
  it("still reports a stalled applicant the carrier has no address for", () => {
    const [nudge] = planApplicationNudges([candidate({ email: null })], NOW);
    expect(nudge?.invitationId).toBe("inv-1");
    expect(nudge?.email).toBeNull();
  });

  it("treats a whitespace address as no address", () => {
    expect(planApplicationNudges([candidate({ email: "   " })], NOW)[0]?.email).toBeNull();
  });

  /** `furthest_section` is free text in the database and may hold a token from a future form. */
  it("reports no section rather than an unknown one", () => {
    expect(planApplicationNudges([candidate({ furthest_section: "references" })], NOW)[0]?.furthestSection).toBeNull();
    expect(planApplicationNudges([candidate({ furthest_section: null })], NOW)[0]?.furthestSection).toBeNull();
  });
});
