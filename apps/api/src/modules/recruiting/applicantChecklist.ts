import type { SupabaseClient } from "@supabase/supabase-js";
import {
  driverInquiryQueue,
  hiringChecklist,
  type AuthorizationRow,
  type HiringChecklist,
  type HiringChecklistInputs,
  type QueueAttempt,
  type QueueEmployment,
} from "@silvicom/shared";
import { hasPspRequest } from "../psp/index.js";

/**
 * Gather the evidence one applicant's checklist folds over (B3, `HIRING-MODULE-PLAN.md` §9).
 *
 * ── THIS MODULE DECIDES NOTHING ────────────────────────────────────────────────────────────────
 * Every rule about what a step means, what blocks it and who owes the next move lives in
 * `hiringChecklist.ts` in `packages/shared`, because the office board, the applicant's own screen
 * and the tests must all fold the same evidence the same way (D-HM2). What happens here is reading
 * rows and naming which column is which. ⚠ If a question about hiring can be answered in this file,
 * it is in the wrong file — that is how the applicant comes to be told they are waiting on us while
 * the office is told it is waiting on them, which is what §1's board defects were, twice.
 *
 * ── THE SERVICE ROLE BYPASSES RLS ──────────────────────────────────────────────────────────────
 * ⚠ So every read below org-filters itself, without exception, and `applicantChecklist.test.ts`
 * asserts it through `supabaseRecorder`'s `expectOrgScoped` rather than trusting the review that
 * noticed. Nine reads is nine chances to leave one off — Q-HM9 added the two that fold the §391.23
 * investigation, and they are org-filtered for the same reason as the other seven.
 */

/** The driver is not this org's, or is not there at all. Told apart from an empty checklist. */
export interface ChecklistError {
  code: "not_found";
  message: string;
}

export const isChecklistError = (v: unknown): v is ChecklistError =>
  typeof v === "object" && v !== null && (v as ChecklistError).code === "not_found";

/** Just enough of the invitation to answer phases — the token hash is never selected. */
const INVITE_COLS = "id, created_at, review_requested_at, approved_at, submitted_at, revoked_at";

export async function applicantChecklist(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  // ⚠ A parameter rather than a `new Date()` inside, for `boardChecklists`' stated reason: the
  // §391.23(a)(2) three-year window is measured from the hire date or, for an applicant, from today
  // — so a function that read the clock itself could only be tested at a particular hour.
  today: string = new Date().toISOString().slice(0, 10),
): Promise<HiringChecklist | ChecklistError> {
  // ⚠ First, and it is a membership check rather than a lookup: the service role would happily read
  // another org's rows for this id, so the 404 below is what makes every read after it safe to
  // believe. `hire_date` comes back in the same round trip because step 14 is the only thing that
  // reads it.
  const { data: driver } = await admin
    .from("drivers")
    .select("id, hire_date")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!driver) {
    return { code: "not_found", message: "That applicant is not in this organization." };
  }

  /**
   * The LIVE invitation: the newest one that has not been REVOKED.
   *
   * ⚠ A driver can have several — a link that expired and was re-sent, or a rehire, which 0337 is
   * explicit must not merge with the first application. Reading the newest is the only answer that
   * stays right through both: an older row's stamps describe a hire that already happened or a link
   * that was replaced, and folding those would report last spring's progress as this week's.
   *
   * ⚠ **`revoked_at` was missing from this rule until B4 and that was a real divergence, not a
   * nicety.** `applicationIntake`'s `resolveInvitation` treats a revoked row as dead, and the
   * pipeline that draws the board beside this one has always skipped them. So the same driver could
   * be described by two different invitations on two adjacent surfaces — which is D-HM2's failure
   * named exactly: *the applicant can never be told they are waiting on us while the office is told
   * the opposite*. One rule, in the one place each caller reads it.
   *
   * A `.limit(1)` cannot express "newest unrevoked" in PostgREST without a filter, so the filter is
   * the `.is("revoked_at", null)` below rather than a slice taken afterwards.
   */
  const { data: invites } = await admin
    .from("application_invitations")
    .select(INVITE_COLS)
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const invitation = ((invites ?? []) as InvitationRow[])[0] ?? null;

  const [authorizations, kinds, pspRequested, packetMarks, hasDraft, investigation] = await Promise.all([
    readAuthorizations(admin, orgId, driverId),
    readQualificationKinds(admin, orgId, driverId),
    // ⚠ Through the psp module's own interface, never `psp_requests` directly: that table is its
    // (D-SEP1) and `lint:table-access` refuses a raw read from here — correctly, and it caught this.
    hasPspRequest(admin, orgId, driverId),
    readPacketMarks(admin, orgId, invitation?.id ?? null),
    readHasDraft(admin, orgId, invitation?.id ?? null),
    readInvestigation(admin, orgId, driverId, (driver as { hire_date: string | null }).hire_date, today),
  ]);

  const input: HiringChecklistInputs = {
    invitedAt: invitation?.created_at ?? null,
    phases: invitation
      ? {
          reviewRequestedAt: invitation.review_requested_at,
          approvedAt: invitation.approved_at,
          submittedAt: invitation.submitted_at,
        }
      : null,
    hasDraft,
    authorizations,
    qualificationKinds: kinds,
    psp: {
      requested: pspRequested,
      // ⚠ The REPORT is a `qualification_records` row of kind `psp_report`, not a settled
      // `psp_requests` row — and that is what makes D-HUI5 liveable rather than a nag: a PSP bought
      // on FMCSA's portal and filed by hand through `/psp-imports` ticks this step exactly as an
      // ordered one does. D-HM6's "recorded acts, not integrations", read from the evidence side.
      reportReceived: kinds.includes("psp_report"),
    },
    packetMarks,
    investigation,
    hiredAt: (driver as { hire_date: string | null }).hire_date,
  };

  return hiringChecklist(input);
}

interface InvitationRow {
  id: string;
  created_at: string;
  review_requested_at: string | null;
  approved_at: string | null;
  submitted_at: string | null;
  revoked_at: string | null;
}

/**
 * The §391.23(a)(2) investigation, folded by the function that already owns the rules (Q-HM9).
 *
 * ⚠ `driverInquiryQueue` decides which employers are owed an inquiry and which of them are still
 * open, and this module deliberately does not second-guess any of it — the window, the DOT-regulated
 * filter, and the ruling that a DOCUMENTED non-response is DONE (§391.23(c)(1) accepts "documentation
 * of good faith efforts" in place of a reply) are all its. The alternative was a `.select` with a
 * `.neq("outcome", …)` here, which is this repo's *deriving beats restating* failure exactly: a
 * second, simpler and wrong copy of a rule that already exists, and the one that would quietly report
 * a lawful file as incomplete for ever.
 *
 * ⚠ Both reads org-filter themselves. The inquiries are additionally filtered to
 * `kind = 'safety_performance'`, matching `loadInquiryQueue`: `drug_alcohol` is §40.25 and applies to
 * non-FMCSA DOT employment only, so counting it would hold the step open for an inquiry §391.23(e)
 * says to route to the Clearinghouse instead.
 */
async function readInvestigation(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  hireDate: string | null,
  today: string,
): Promise<{ outstanding: number; awaiting: number }> {
  const [{ data: employment }, { data: inquiries }] = await Promise.all([
    admin
      .from("driver_employment_history")
      .select("id, employer_name, started_on, ended_on, dot_regulated")
      .eq("org_id", orgId)
      .eq("driver_id", driverId),
    admin
      .from("employer_inquiries")
      .select("employment_id, contacted_on, outcome")
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .eq("kind", "safety_performance"),
  ]);

  const attempts = ((inquiries ?? []) as Array<Record<string, unknown>>).map(
    (row): QueueAttempt => ({
      employmentId: String(row.employment_id),
      contactedOn: String(row.contacted_on),
      outcome: row.outcome as QueueAttempt["outcome"],
    }),
  );

  const queue = driverInquiryQueue({
    employment: ((employment ?? []) as Array<Record<string, unknown>>).map(
      (row): QueueEmployment => ({
        id: String(row.id),
        employerName: String(row.employer_name),
        startedOn: String(row.started_on),
        endedOn: (row.ended_on as string | null) ?? null,
        dotRegulated: Boolean(row.dot_regulated),
      }),
    ),
    attempts,
    hireDate,
    today,
  });

  // ⚠ `awaiting` is the one open state that is the EMPLOYER's move. `not_sent`, `overdue` and
  // `undeliverable` are all the office's, so they must not read as "waiting on them" — see the
  // field's note in `hiringChecklist.ts` for the row that shipped saying otherwise.
  return {
    outstanding: queue.outstanding.length,
    awaiting: queue.outstanding.filter((e) => e.state === "awaiting").length,
  };
}

/**
 * The signed instruments, whole rows.
 *
 * ⚠ `hasLiveAuthorization` needs `revokes` and `accepted_at` to work out which grant survives — 0215
 * revokes by writing a NEW row rather than by mutating one, so "what did we hold at the moment we
 * asked" stays answerable. A query that selected only `purpose` would report a revoked release as
 * live.
 */
async function readAuthorizations(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<AuthorizationRow[]> {
  const { data } = await admin
    .from("driver_authorizations")
    .select("id, purpose, accepted_at, revokes")
    .eq("org_id", orgId)
    .eq("driver_id", driverId);
  return (data ?? []) as AuthorizationRow[];
}

/**
 * Which §391.51 events this driver has on file, as kinds.
 *
 * ⚠ Kinds and nothing else, because that is all the fold asks for. Recurrence and expiry belong to
 * `dqCatalogue.ts`, which already owns them; a service that started handing whole records over would
 * be inviting a second opinion about when an MVR goes stale.
 */
async function readQualificationKinds(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<string[]> {
  const { data } = await admin
    .from("qualification_records")
    .select("kind")
    .eq("org_id", orgId)
    .eq("driver_id", driverId);
  return [...new Set(((data ?? []) as Array<{ kind: string }>).map((r) => r.kind))];
}

/**
 * How many of the packet's places this link has collected.
 *
 * ⚠ Keyed on the INVITATION, never the driver — `application_packet_marks` is invitation-scoped for
 * 0339's stated reason, that a rehire signs their own packet and the two must not merge. A
 * driver-keyed count would add last year's twenty-two to this year's none and report a packet signed
 * that nobody has opened.
 */
async function readPacketMarks(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
): Promise<number> {
  if (!invitationId) return 0;
  const { data } = await admin
    .from("application_packet_marks")
    .select("id")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  return ((data ?? []) as unknown[]).length;
}

/**
 * Has the applicant typed anything (F5)?
 *
 * ⚠ The row's existence, never its payload. The answer needed is one boolean; selecting the draft
 * would pull a date of birth and a licence number into a response about progress, and A11's rule is
 * that answers have their own surface.
 */
async function readHasDraft(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
): Promise<boolean> {
  if (!invitationId) return false;
  const { data } = await admin
    .from("application_drafts")
    .select("invitation_id")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}
