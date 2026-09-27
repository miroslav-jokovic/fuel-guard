import type { AuthorizationRow } from "./authorizationContract.js";
import type { ApplicationPhases } from "./applicationReviewContract.js";
import type { ApplyingAs } from "./questionnaireContract.js";

/**
 * What `hiringChecklist()` is GIVEN — every field a row a caller already has, never a query.
 *
 * ⚠ **Split out of `hiringChecklist.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §7, C2b2)**, at the
 * 450-line warning, before §7's three new inputs pushed it past the budget. The seam is given versus
 * decided: this file names the evidence and what its absence means, that one folds it. The API's one
 * builder of it is `applicantChecklistInputs.ts` (G-7).
 */

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
  /** The live invitation's phase stamps, from the permissions onward (`ApplicationPhases`). */
  phases?: ApplicationPhases | null;
  /**
   * Part 1 (D-AW1, §7): whether this invitation has an `application_intakes` row — which is what makes
   * it a v2 link (`intakeState`, C2a) — and when `complete_applicant_intake` stamped it finished.
   *
   * ⚠ Absent reads as LEGACY, the state before this field existed and the state of all eight
   * production invitations on 2026-09-26. The legacy rule (§7, stated once) is the fold's.
   */
  intake?: { v2: boolean; completedAt: string | null } | null;
  /**
   * Is the §391.21(b)(4) identity on the driver's row — date of birth, licence number and state
   * (`APPLICANT_IDENTITY_KEYS`)? Read ONLY by the legacy rule: 0365's identity screen was a legacy
   * link's Part 1, so an applicant who gave it has finished what Part 1 was for them.
   *
   * ⚠ The row, not the draft. `identityOnFile` also checks the draft because it gates a SIGNATURE;
   * this answers "can the office screen them", which is the row's question alone.
   */
  identityOnFile?: boolean;
  /**
   * Is there a live trip — an `applicant_travel` row on this invitation that is not cancelled (D-AW7)?
   * Absent reads as no trip.
   */
  travelBooked?: boolean;
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
  /**
   * Where the handbook ceremony stands (HANDBOOK-SIGNING-PLAN.md): opened by the office, and whether
   * every driver place is signed. Only drives `inFlight`; the step is DONE on the filed record.
   */
  handbook?: { openedAt: string | null; driverComplete: boolean } | null;
  /**
   * The jurisdiction each MVR on file was recorded for — `detail.jurisdiction`, null where none was
   * written (AF7). One entry per MVR row, not deduped: the fold only asks which are covered.
   */
  mvrJurisdictions?: readonly (string | null)[];
  /**
   * Every licensing jurisdiction the applicant has declared on the live invitation's draft
   * (`declaredLicenceJurisdictions`). Empty while none is known, which is when one MVR is enough.
   *
   * ⚠ The DRAFT, not the filed application: an application files at the very end, in the office,
   * and the MVR is a `beforeTravel` gate — a rule that waited for the filing would learn about the
   * second state after the plane ticket. Since AF3 the draft holds `cdl_state` from the permissions
   * step onward, so this is known before the MVR is ordered.
   */
  licenceJurisdictions?: readonly string[];
  /**
   * When the link's permission ceremony closed (`application_invitations.releases_completed_at`). A
   * closed ceremony asks for nothing more, so a purpose still missing after it is the office's to
   * record on paper (A-4). Absent reads as "still open" — the state before this field existed.
   */
  releasesCompletedAt?: string | null;
  /**
   * Whether a road test on file was PASSED (A-8) — see `roadTestCounts`. Absent reads as "any
   * `road_test` kind counts", the state before this field existed; the board's builder still relies
   * on that until G-7 gives both builders one input.
   */
  roadTestPassed?: boolean;
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
  /**
   * What the applicant said they are applying as (`applyingAsOf`), which decides how many places
   * their packet has (Q-HM14).
   *
   * ⚠ Absent reads as null — the paper's walk, one more stop than a company driver's — so a caller
   * that forgets it leaves a company driver's signed packet OUTSTANDING, which is the failure that
   * shows. The other way round it could not fail: no walk is longer than the paper's.
   */
  applyingAs?: ApplyingAs | null;
  /** The hire date, once there is one. */
  hiredAt?: string | null;
}
