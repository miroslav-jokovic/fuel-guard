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
 * ── ONE NUDGE PER PART (Q-AW37 (b), owner 2026-09-27; 0377) ──────────────────────────────────
 * Since D-AF1 the link is two visits weeks apart: Part 1 (getting started, ending with the
 * permissions) and, after the office's screening, Part 2 (the form). Each may be reminded ONCE. A
 * recruiting system that emails an applicant every six hours is one whose emails get filtered, and the
 * carrier's domain reputation is not a thing to spend on a second reminder about the same step.
 * `nudged_at` holds the latest stamp; one EARLIER than `application_sent_at` was the Part 1 reminder
 * and leaves Part 2's open, one after it closes the invitation. 0377 keeps the same rule inside the
 * rotation, so a read-then-write race cannot spend a part twice.
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
  /**
   * When the office sent the application form (AF4, 0365). Null while the link carries only the
   * permissions — see `planApplicationNudges` for why that is never abandonment.
   */
  application_sent_at: string | null;
  /** Null when the driver opened the link and typed nothing — there is no work to come back to. */
  draft_updated_at: string | null;
  furthest_section: string | null;
  /** The e-sign consent — the first thing Part 1 records. Null: they never began, nothing to come back to. */
  consented_at: string | null;
  /** The permissions finished — the end of Part 1. From here the wait is the office's screening. */
  releases_completed_at: string | null;
  /**
   * The latest thing Part 1 wrote outside the draft — the intake row, a photograph, a signed permission
   * — or null when there is none. The sweep reads these three tables; the fold only compares.
   */
  part_one_activity_at: string | null;
}

/** Which visit the driver stopped in. Each gets its own reminder and its own office alert. */
export type NudgePart = "part_one" | "part_two";

export interface PlannedNudge {
  invitationId: string;
  driverId: string;
  part: NudgePart;
  /**
   * Null when the invitation carries no address. The office is still told — that is the cue to pick
   * up the phone — but nothing is emailed and nothing is stamped, because a nudge nobody could
   * receive must not spend the one nudge this invitation gets.
   */
  email: string | null;
  /**
   * The screen they stopped on, for the office's alert. `furthest_section` is free text in the DB, and
   * it names Part 2's sections only, so a Part 1 nudge never carries one.
   */
  furthestSection: ApplicationSection | null;
  /** Per invitation AND part, so `emit_notification` tells the office once per part and never again. */
  dedupeKey: string;
}

/** The latest of some instants, or null when there are none. ISO strings compared as instants. */
function latest(...values: Array<string | null>): number | null {
  const times = values.filter((v): v is string => v !== null).map((v) => Date.parse(v));
  return times.length === 0 ? null : Math.max(...times);
}

/**
 * Which part the driver is in, or null when neither can be nudged — the phase stamps, read in order.
 *
 *   · the form sent (`application_sent_at`) — Part 2, reminded unless a stamp LATER than the send
 *     says Part 2's reminder is spent (0377);
 *   · consented, permissions not finished — Part 1, reminded unless any stamp exists (before the send
 *     every stamp is Part 1's);
 *   · never consented — nothing begun; the permissions finished and the form unsent — waiting on the
 *     office's screening (see below). Neither is abandonment.
 */
function partOf(c: NudgeCandidate): NudgePart | null {
  if (c.application_sent_at) {
    const spent = c.nudged_at !== null && Date.parse(c.nudged_at) >= Date.parse(c.application_sent_at);
    return spent ? null : "part_two";
  }
  if (!c.consented_at || c.releases_completed_at) return null;
  return c.nudged_at ? null : "part_one";
}

/**
 * When the driver last did anything in the part they are in.
 *
 * ⚠ **Part 2's clock starts at the office's Send, not at the draft.** AF3 writes the draft on the
 * first visit, so an application sent days after Part 1 carries a draft days old the moment it
 * arrives, and a clock that read only the draft reminded the driver at once — ROTATING the token and
 * killing the link the office had just sent them (found 2026-09-27, C3c3b). A form nobody has had
 * two days with has not been abandoned.
 *
 * Part 1 writes to four places, and any of them is a sign of life: the consent, the draft (AF3's
 * identity step), and the intake row, photographs and permissions the sweep folds into
 * `part_one_activity_at`.
 */
function lastActivity(c: NudgeCandidate, part: NudgePart): number | null {
  return part === "part_two"
    ? (c.draft_updated_at ? latest(c.draft_updated_at, c.application_sent_at) : null)
    : latest(c.consented_at, c.draft_updated_at, c.part_one_activity_at);
}

/**
 * Who is stalled, and in which part.
 *
 * Every exclusion is a fact about the invitation rather than a heuristic:
 *   · submitted — they finished; there is nothing to come back to
 *   · revoked — the carrier took the link away, and this must never hand it back
 *   · expired — the link is dead, and the plan's rule is that a nudge extends a live link rather
 *     than resurrecting a dead one; a carrier who wants a lapsed candidate back issues a new one
 *   · already nudged in this part — once per part (0377)
 *   · handed to the office, or approved by it — see below; they did not walk away, they are waiting
 *   · nothing begun (no consent), or in Part 2 no draft — nothing to come back to
 *   · last active inside the window — nothing abandoned yet
 *   · permissions finished, application not sent yet — see below; that wait is the office's, too
 *
 * ── ⚠ AND SO IS WAITING FOR THE APPLICATION (AF4, 2026-09-24) ─────────────────────────────────
 * Since D-AF1 the first visit ends with the permissions, and the driver then waits while the office
 * screens them — PSP, the MVR, the Clearinghouse query, a drug test — before it sends the form. That
 * wait routinely outlasts forty-eight hours, and AF3's identity step writes a draft on the first
 * visit, so without this rule every applicant in screening looks abandoned: the office is told they
 * stopped part-way, and the sweep rotates a link the office is about to send them again anyway.
 * A driver who stops BEFORE finishing the permissions is the opposite case — nobody can screen them
 * until they finish — and is Part 1's reminder (C3c3b).
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

  return candidates.flatMap((c) => {
    if (c.submitted_at || c.revoked_at) return [];
    if (c.review_requested_at || c.approved_at) return [];
    if (Date.parse(c.expires_at) <= now) return [];
    const part = partOf(c);
    if (!part) return [];
    const last = lastActivity(c, part);
    if (last === null || last >= staleBefore) return [];
    return [{
      invitationId: c.id,
      driverId: c.driver_id,
      part,
      email: c.email?.trim() ? c.email.trim() : null,
      furthestSection: part === "part_two" && isApplicationSection(c.furthest_section) ? c.furthest_section : null,
      // Part 2 keeps the key it always had, so an alert already raised is not raised again.
      dedupeKey: part === "part_two" ? `application_stalled:${c.id}` : `application_stalled_part_one:${c.id}`,
    }];
  });
}
