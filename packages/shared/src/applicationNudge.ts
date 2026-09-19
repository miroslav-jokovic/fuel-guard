import { isApplicationSection, type ApplicationSection } from "./applicationSections.js";

/**
 * Abandonment recovery — who walked away, and who may be asked back (A10, D-APP15).
 *
 * ── THE FINDING THIS EXISTS FOR ───────────────────────────────────────────────────────────────
 * The market's one durable lesson about these forms is that the entire product battle is not losing
 * the driver mid-form: DriverReach's "Magic Links" exist to recapture people who abandoned, and both
 * they and Tenstreet report ~90% mobile completion because of it. A2 gave the session a memory; this
 * is the reason to have one. A driver who stopped at the employment section on a truck-stop connection
 * has typed thirty minutes of their history into a form nobody will ever ask them to finish.
 *
 * ── ONE NUDGE, EVER ───────────────────────────────────────────────────────────────────────────
 * `nudged_at` is stamped once and the fold refuses a stamped invitation for good. A recruiting system
 * that emails an applicant every six hours is a recruiting system whose emails get filtered, and the
 * carrier's domain reputation is not a thing to spend on a second reminder.
 *
 * ── AND WHY THE FOLD IS PURE ──────────────────────────────────────────────────────────────────
 * Because every one of its rules is a decision about somebody's inbox, and each is one line to state
 * and one line to test: submitted, revoked, expired, already nudged, still warm. A sweep that decided
 * these inside a database query would be a set of rules nobody could read back.
 */

/**
 * How long a draft sits untouched before its owner is presumed gone.
 *
 * Two days rather than two hours: a driver who starts an application on Friday evening and finishes
 * it on Saturday morning has not abandoned anything, and an email telling them otherwise is an email
 * that reads as automated pestering. It is long enough that a nudge is news and short enough that the
 * candidate is still deciding.
 */
export const STALE_DRAFT_HOURS = 48;

/** One invitation, as the sweep reads it — the invitation joined to whatever draft it holds. */
export interface NudgeCandidate {
  id: string;
  driver_id: string;
  /** Where the recruiter sent the link. Null when they issued it to be passed on by hand. */
  email: string | null;
  expires_at: string;
  revoked_at: string | null;
  submitted_at: string | null;
  nudged_at: string | null;
  /**
   * When the driver handed the application to the office (`requestReview`), and when the office
   * approved it. Both are here for one reason: after either stamp the draft stops changing because
   * the driver has nothing left to type, which is indistinguishable from abandonment to a rule that
   * only reads `draft_updated_at`.
   */
  review_requested_at: string | null;
  approved_at: string | null;
  /** Null when the driver opened the link and typed nothing — there is no work to come back to. */
  draft_updated_at: string | null;
  furthest_section: string | null;
}

export interface PlannedNudge {
  invitationId: string;
  driverId: string;
  /**
   * Null when the invitation carries no address. The office is still told — that is the cue to pick
   * up the phone — but nothing is emailed and nothing is stamped, because a nudge nobody could
   * receive must not spend the one nudge this invitation gets.
   */
  email: string | null;
  /** The screen they stopped on, for the office's alert. `furthest_section` is free text in the DB. */
  furthestSection: ApplicationSection | null;
  /** Per invitation, so `emit_notification` tells the office once and never again. */
  dedupeKey: string;
}

/**
 * Who is stalled.
 *
 * Every exclusion is a fact about the invitation rather than a heuristic:
 *   · submitted — they finished; there is nothing to come back to
 *   · revoked — the carrier took the link away, and this must never hand it back
 *   · expired — the link is dead, and the plan's rule is that a nudge extends a live link rather
 *     than resurrecting a dead one; a carrier who wants a lapsed candidate back issues a new one
 *   · already nudged — once, ever
 *   · handed to the office, or approved by it — see below; they did not walk away, they are waiting
 *   · no draft, or a draft touched inside the window — nothing abandoned yet
 *
 * ── ⚠ WAITING ON US IS NOT ABANDONMENT (A1, 2026-09-18) ───────────────────────────────────────
 * The moment a driver taps "send to the office" their draft stops changing, and forty-eight hours
 * later it looks exactly like a draft somebody walked away from. It is the opposite: the person who
 * stopped working is the carrier. Nudging them would be bad enough on its own — the office is told
 * "X stopped part-way through their application" about an applicant who is in fact waiting on the
 * office — but the sweep also ROTATES the token (0232), so it would take the link out from under
 * somebody whose next act is to sign. Measured in production on 2026-09-18: invitation
 * `f2b142e4…` was approved, unrevoked, unexpired, carried an address, and its draft had sat
 * untouched for thirty hours. It was about eighteen hours from having its link rotated.
 *
 * ⚠ BOTH stamps, not just the first. Approval does not clear `review_requested_at`, so the measured
 * row carried both — but the two are separate exits from the driver's hands, and an application can
 * be approved without a review having been requested through this path. Excluding one would leave
 * the other as a door into the same failure.
 */
export function planApplicationNudges(
  candidates: readonly NudgeCandidate[],
  nowIso: string,
  staleHours: number = STALE_DRAFT_HOURS,
): PlannedNudge[] {
  const now = Date.parse(nowIso);
  const staleBefore = now - staleHours * 3_600_000;

  return candidates
    .filter((c) => {
      if (c.submitted_at || c.revoked_at || c.nudged_at) return false;
      if (c.review_requested_at || c.approved_at) return false;
      if (Date.parse(c.expires_at) <= now) return false;
      if (!c.draft_updated_at) return false;
      return Date.parse(c.draft_updated_at) < staleBefore;
    })
    .map((c) => ({
      invitationId: c.id,
      driverId: c.driver_id,
      email: c.email?.trim() ? c.email.trim() : null,
      furthestSection: isApplicationSection(c.furthest_section) ? c.furthest_section : null,
      dedupeKey: `application_stalled:${c.id}`,
    }));
}
