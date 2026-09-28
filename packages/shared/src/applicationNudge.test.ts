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
  review_requested_at: null,
  approved_at: null,
  // Sent: the ordinary nudge candidate is somebody who was given the form and stopped filling it.
  application_sent_at: hoursAgo(96),
  draft_updated_at: hoursAgo(72),
  furthest_section: "employment",
  consented_at: hoursAgo(300),
  releases_completed_at: hoursAgo(290),
  part_one_activity_at: hoursAgo(290),
  ...over,
});

/** A driver who began Part 1 and stopped before the permissions were finished. */
const partOne = (over: Partial<NudgeCandidate> = {}): NudgeCandidate => candidate({
  application_sent_at: null,
  releases_completed_at: null,
  consented_at: hoursAgo(100),
  draft_updated_at: hoursAgo(90),
  part_one_activity_at: hoursAgo(80),
  furthest_section: null,
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
    expect(nudge?.part).toBe("part_two");
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

  /** Once per part. A system that reminds an applicant every six hours gets filtered. */
  it("never nudges twice in Part 2", () => {
    expect(planApplicationNudges([candidate({ nudged_at: "2026-08-20T10:00:00Z" })], NOW)).toEqual([]);
  });

  /** A stamp at the very instant of the send is not proof it was Part 1's — 0377's strict `<`. */
  it("reads a stamp at the instant of the send as Part 2's", () => {
    const sent = hoursAgo(96);
    expect(planApplicationNudges([candidate({ application_sent_at: sent, nudged_at: sent })], NOW)).toEqual([]);
  });

  /**
   * ⚠ C3c3b: AF3 writes the draft on the first visit, so a form sent days after Part 1 arrives with an
   * old draft. Reading only the draft reminded the driver at once and rotated away the link the office
   * had just sent.
   */
  it("starts Part 2's clock at the office's Send, not at the older draft", () => {
    const justSent = candidate({ application_sent_at: hoursAgo(2), draft_updated_at: hoursAgo(200) });
    expect(planApplicationNudges([justSent], NOW)).toEqual([]);
    const sentAndLeft = candidate({ application_sent_at: hoursAgo(STALE_DRAFT_HOURS + 1), draft_updated_at: hoursAgo(200) });
    expect(planApplicationNudges([sentAndLeft], NOW)).toHaveLength(1);
  });
});

/**
 * C3c3b — the driver who stopped in Part 1 (Q-AW37 (b), one reminder per part). They consented, and
 * did not finish the permissions; nobody can screen them until they do, so this wait is theirs.
 */
describe("the driver who stopped in Part 1", () => {
  it("is nudged, as Part 1, with its own office alert and no section", () => {
    const [nudge] = planApplicationNudges([partOne()], NOW);
    expect(nudge).toMatchObject({
      invitationId: "inv-1", part: "part_one", email: "susan@example.test", furthestSection: null,
      dedupeKey: "application_stalled_part_one:inv-1",
    });
  });

  it("carries no section even when the draft names one — sections are Part 2's", () => {
    expect(planApplicationNudges([partOne({ furthest_section: "employment" })], NOW)[0]?.furthestSection).toBeNull();
  });

  /** Each of the four places Part 1 writes is a sign of life on its own. */
  it("is left alone while anything Part 1 wrote is inside the window", () => {
    const warm = hoursAgo(STALE_DRAFT_HOURS - 1);
    expect(planApplicationNudges([partOne({ consented_at: warm, draft_updated_at: null, part_one_activity_at: null })], NOW)).toEqual([]);
    expect(planApplicationNudges([partOne({ draft_updated_at: warm })], NOW)).toEqual([]);
    expect(planApplicationNudges([partOne({ part_one_activity_at: warm })], NOW)).toEqual([]);
  });

  /** The window's edge: exactly forty-eight hours is still inside it, as it always was for Part 2. */
  it("is left alone at exactly the window's edge, and nudged a moment past it", () => {
    const edge = { consented_at: hoursAgo(STALE_DRAFT_HOURS), draft_updated_at: null, part_one_activity_at: null };
    expect(planApplicationNudges([partOne(edge)], NOW)).toEqual([]);
    expect(planApplicationNudges([partOne({ ...edge, consented_at: hoursAgo(STALE_DRAFT_HOURS + 0.001) })], NOW)).toHaveLength(1);
  });

  /** A consent and nothing after it is still a driver who began — Part 1's first write is the consent. */
  it("is nudged on a stale consent alone", () => {
    expect(planApplicationNudges([partOne({ draft_updated_at: null, part_one_activity_at: null })], NOW)).toHaveLength(1);
  });

  it("is never nudged when they never consented — nothing was begun", () => {
    expect(planApplicationNudges([partOne({ consented_at: null })], NOW)).toEqual([]);
  });

  /** Permissions finished and the form unsent is the office's screening, however long it takes. */
  it("is never nudged once the permissions are finished", () => {
    expect(planApplicationNudges([partOne({ releases_completed_at: hoursAgo(90) })], NOW)).toEqual([]);
  });

  it("is nudged once in Part 1", () => {
    expect(planApplicationNudges([partOne({ nudged_at: hoursAgo(60) })], NOW)).toEqual([]);
  });

  /** The ruling itself: Part 1's reminder does not spend Part 2's. */
  it("is nudged again in Part 2 after a Part 1 reminder", () => {
    const [nudge] = planApplicationNudges([candidate({ nudged_at: hoursAgo(150), application_sent_at: hoursAgo(96) })], NOW);
    expect(nudge?.part).toBe("part_two");
  });

  it("is subject to every exit a Part 2 candidate is", () => {
    for (const exit of [
      { submitted_at: hoursAgo(1) }, { revoked_at: hoursAgo(1) }, { expires_at: hoursAgo(1) },
      { review_requested_at: hoursAgo(1) }, { approved_at: hoursAgo(1) },
    ]) expect(planApplicationNudges([partOne(exit)], NOW)).toEqual([]);
  });
});

/**
 * ⚠ A1 — the driver who is waiting on US (2026-09-18).
 *
 * These four are not variations on "somebody finished". They are the case where the draft stops
 * changing for the best possible reason: the driver handed the application over, and the party who
 * has stopped working is the carrier. Every fixture here is deliberately TEN days stale, far past
 * the window, so that the only thing keeping each one out of the plan is the stamp under test —
 * a fixture that was merely fresh would pass whether or not the rule exists.
 *
 * What makes this worth four tests rather than one: the sweep rotates the token (0232), so a nudge
 * here does not merely send a redundant email, it takes the link out from under somebody whose next
 * act is to sign. Measured in production 2026-09-18: one approved invitation was about eighteen
 * hours from exactly that.
 */
describe("the driver who is waiting on the office", () => {
  const ancient = { draft_updated_at: hoursAgo(240) };

  it("never nudges an application already handed to the office", () => {
    expect(planApplicationNudges([candidate({ ...ancient, review_requested_at: "2026-08-15T09:00:00Z" })], NOW))
      .toEqual([]);
  });

  /**
   * Approval does not clear the review stamp, so this is what the production row actually looked
   * like — and it is why excluding one stamp would not have been enough.
   */
  it("never nudges an approved application, review stamp and all", () => {
    expect(planApplicationNudges([candidate({
      ...ancient,
      review_requested_at: "2026-08-15T09:00:00Z",
      approved_at: "2026-08-16T09:00:00Z",
    })], NOW)).toEqual([]);
  });

  /** The second stamp on its own — approval reached by any path that did not stamp the first. */
  it("never nudges an approved application that carries no review stamp", () => {
    expect(planApplicationNudges([candidate({ ...ancient, approved_at: "2026-08-16T09:00:00Z" })], NOW))
      .toEqual([]);
  });

  /**
   * And the discriminator: the same ten-day-old draft with neither stamp IS nudged. Without this the
   * three above would still pass if the fold had simply stopped nudging anybody.
   */
  it("still nudges an equally stale draft that was never handed over", () => {
    expect(planApplicationNudges([candidate(ancient)], NOW)[0]?.invitationId).toBe("inv-1");
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

/**
 * ⚠ AF4: a driver whose permissions are in and whose application has not been SENT is waiting on the
 * office's screening, not walking away — and AF3's identity step gives them a draft on the first
 * visit, so a stale draft is exactly what they look like. Ten days, because screening waits on a lab.
 */
describe("waiting for the office to send the application", () => {
  it("is never nudged, however old the draft", () => {
    expect(planApplicationNudges([candidate({ application_sent_at: null, draft_updated_at: hoursAgo(240) })], NOW)).toEqual([]);
  });

  it("is nudged once it has been sent and then left", () => {
    expect(planApplicationNudges([candidate({ application_sent_at: hoursAgo(200), draft_updated_at: hoursAgo(72) })], NOW)).toHaveLength(1);
  });
});
});
