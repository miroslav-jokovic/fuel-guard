import {
  applicantProgress,
  asApplyingAs,
  declaredLicenceJurisdictions,
  currentDisposition,
  employmentCoverage,
  type ApplicantDispositionRow,
  type AuthorizationRow,
  type EmploymentPeriod,
} from "@silvicom/shared";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { DRAFT_APPLYING_AS_SELECT } from "../applicantApplyingAs.js";
import { DRAFT_LICENCES_SELECT } from "../applicantLicences.js";
import { boardChecklists } from "../applicantBoard.js";

/**
 * `GET /pipeline` — the applicant board's read, and the history columns it shares with the
 * employment routes.
 *
 * ⚠ **Split out of `employment.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at the
 * 450-line warning. The handler moved whole — same queries, same order, same response — and
 * `recruitmentEmploymentRouter` still registers it first, at the same path, behind the same
 * `requireOrg` and `recruitment:view` guards; it READS only, so no table gained a writer. That
 * file's header — the recruitment section boundary, and the service role that bypasses RLS so every
 * query below filters `org_id` itself — applies here unchanged.
 */

export const HISTORY_COLS =
  "id, driver_id, employer_name, usdot_number, employer_city, employer_state, employer_phone, employer_email, position_held, started_on, ended_on, dot_regulated, operated_cmv, subject_to_fmcsr, safety_sensitive, reason_for_leaving, inquiry_status, inquiry_sent_on, inquiry_response_on, source, notes, created_at, updated_at";

interface HistoryRow {
  id: string;
  driver_id: string;
  employer_name: string;
  started_on: string;
  ended_on: string | null;
  dot_regulated: boolean;
  operated_cmv: boolean | null;
  inquiry_status: string;
}

/** The live invitation, for the stages that exist before an application is filed (F5). */
interface InvitationRow {
  id: string;
  driver_id: string;
  application_sent_at: string | null;
  review_requested_at: string | null;
  approved_at: string | null;
  signing_opened_at: string | null;
  submitted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  handbook_signing_opened_at: string | null;
}

/** The shape `employmentCoverage` judges — the DB row minus everything the arithmetic ignores. */
const toPeriod = (r: HistoryRow): EmploymentPeriod => ({
  id: r.id,
  employerName: r.employer_name,
  startedOn: r.started_on,
  endedOn: r.ended_on,
  dotRegulated: r.dot_regulated,
  operatedCmv: r.operated_cmv,
  inquiryStatus: r.inquiry_status as EmploymentPeriod["inquiryStatus"],
});

/**
 * The APPLICANT pipeline — who is waiting on what (H6).
 *
 * This replaced a fleet table of every driver with their gaps and inquiry state, which restated
 * what the qualification page already owns. The boundary that fixes it is D-HIRE2: Recruitment
 * owns the APPLICANT, DQF owns the DRIVER. Once this lists applicants, the two surfaces are not
 * looking at the same people and the duplication has nowhere to come from.
 *
 * Employment history for somebody already hired is still reachable — on their own driver page,
 * where it belongs, rather than in a second fleet-wide table here.
 *
 * The stage is computed by the SAME pure function the page would call, never a second SQL
 * approximation of it: a pipeline that disagrees with the file it summarises is worse than no
 * pipeline. `asOf` is the application date when we have one, which for now is the row's creation.
 */
export const applicantPipelineHandler = asyncHandler(async (req, res) => {
  const admin = getSupabaseAdmin(getAppLocals(req).env);
  const orgId = req.auth!.orgId!;

  // Archived applicants leave the board and nothing else (0235): their row, their draft and
  // anything they signed are untouched and their own page still opens. `?archived=true` is the
  // other half of the same list — the "Archived" chip — rather than a second endpoint.
  const showArchived = String(req.query.archived ?? "") === "true";
  const { data: applicants, error: applicantsError } = await admin
    .from("drivers")
    .select("id, full_name, status, hire_date, date_of_birth, created_at, archived_at")
    .eq("org_id", orgId)
    .eq("status", "applicant")
    .filter("archived_at", showArchived ? "not.is" : "is", null)
    .order("created_at", { ascending: true });
  if (applicantsError) {
    res.status(500).json(apiError("db_error", "Could not list applicants"));
    return;
  }

  const ids = (applicants ?? []).map((a) => a.id);
  if (ids.length === 0) {
    res.json({ applicants: [] });
    return;
  }

  const [history, auths, decisions, invitations, drafts] = await Promise.all([
    admin
      .from("driver_employment_history")
      .select(HISTORY_COLS)
      .eq("org_id", orgId)
      .in("driver_id", ids),
    admin
      .from("driver_authorizations")
      .select("id, driver_id, purpose, accepted_at, revokes")
      .eq("org_id", orgId)
      .in("driver_id", ids),
    // 0238. A decided applicant stays on the board — they are still `status = applicant`, and
    // clearing them off it is what ARCHIVING is for (0235), which is a different act. What the
    // board owes the recruiter is that the decision is VISIBLE, so nobody chases somebody the
    // carrier already turned down.
    admin
      .from("applicant_dispositions")
      .select("id, driver_id, outcome, decided_on, reason, rested_on_consumer_report, decided_by, created_at")
      .eq("org_id", orgId)
      .in("driver_id", ids),
    /**
     * The application's own phases, and whether anything has been typed (F5).
     *
     * ⚠ Without these two the board could only ever say "Not started" for a driver part-way
     * through the form: every other input here comes from `driver_employment_history`, which is
     * written at SUBMISSION. The owner filled in their own test application and was told nothing
     * had happened, on two separate screens, for this reason.
     */
    admin
      .from("application_invitations")
      .select("id, driver_id, application_sent_at, review_requested_at, approved_at, signing_opened_at, submitted_at, revoked_at, created_at, handbook_signing_opened_at")
      .eq("org_id", orgId)
      .in("driver_id", ids)
      .order("created_at", { ascending: false }),
    admin
      .from("application_drafts")
      // ⚠ Named keys by path and never the payload (`applicantApplyingAs.ts`): how many places the
      // packet has (Q-HM14) and which states owe an MVR (AF7), and nothing else in the draft.
      .select(`invitation_id, ${DRAFT_APPLYING_AS_SELECT}, ${DRAFT_LICENCES_SELECT}`)
      .eq("org_id", orgId),
  ]);
  if (history.error || auths.error || decisions.error || invitations.error || drafts.error) {
    res.status(500).json(apiError("db_error", "Could not load the pipeline"));
    return;
  }

  const historyBy = new Map<string, HistoryRow[]>();
  for (const row of (history.data ?? []) as HistoryRow[]) {
    const list = historyBy.get(row.driver_id);
    if (list) list.push(row);
    else historyBy.set(row.driver_id, [row]);
  }
  const decisionsBy = new Map<string, ApplicantDispositionRow[]>();
  for (const row of (decisions.data ?? []) as ApplicantDispositionRow[]) {
    const list = decisionsBy.get(row.driver_id);
    if (list) list.push(row);
    else decisionsBy.set(row.driver_id, [row]);
  }
  /**
   * The invitation a recruiter means when they say "their application" — the newest that is not
   * revoked. A driver can hold several: a link expires, a recruiter sends another, and the one
   * that matters is the live one. Ordered newest-first above, so the FIRST seen per driver wins.
   */
  const inviteBy = new Map<string, InvitationRow>();
  for (const row of (invitations.data ?? []) as InvitationRow[]) {
    if (row.revoked_at) continue;
    if (!inviteBy.has(row.driver_id)) inviteBy.set(row.driver_id, row);
  }
  // ⚠ Keyed on the INVITATION, never on the driver: a rehire's draft from a previous application
  // is not evidence that they have started this one.
  const draftFor = new Map(
    ((drafts.data ?? []) as Array<{ invitation_id: string; applying_as?: unknown; cdl_state?: unknown }>).map((d) => [
      d.invitation_id,
      { applyingAs: asApplyingAs(d.applying_as), licenceJurisdictions: declaredLicenceJurisdictions(d) },
    ]),
  );

  const authsBy = new Map<string, AuthorizationRow[]>();
  for (const row of (auths.data ?? []) as Array<AuthorizationRow & { driver_id: string }>) {
    const list = authsBy.get(row.driver_id);
    if (list) list.push(row);
    else authsBy.set(row.driver_id, [row]);
  }

  /**
   * The hiring checklist for every row, folded set-based (B4).
   *
   * ⚠ It reuses the invitation, the draft flag and the authorizations already read above rather
   * than reading them again, and that is a correctness argument before it is a performance one:
   * `boardChecklists` and `applicantProgress` are two answers about one person on one row, and
   * two independent reads of `application_invitations` could pick different invitations and then
   * disagree in adjacent columns — which is D-HM2's failure exactly.
   */
  const checklists = await boardChecklists(
    admin,
    orgId,
    (applicants ?? []).map((a) => {
      const invite = inviteBy.get(a.id);
      const draft = invite ? draftFor.get(invite.id) : undefined;
      return {
        driverId: a.id,
        hiredAt: (a as { hire_date: string | null }).hire_date,
        invitation: invite ?? null,
        hasDraft: draft !== undefined,
        applyingAs: draft?.applyingAs ?? null,
        licenceJurisdictions: draft?.licenceJurisdictions ?? [],
        authorizations: authsBy.get(a.id) ?? [],
        // ⚠ The NEWEST decision, through the same `currentDisposition` the row below uses — the
        // table is append-only, so a carrier that declines and then changes its mind has two rows
        // and only the later one is the answer. Reading `.length > 0` here would keep a
        // reconsidered applicant off the board's own queue for ever.
        decided: currentDisposition(decisionsBy.get(a.id) ?? []) !== null,
      };
    }),
  );

  const rows = (applicants ?? []).map((a) => {
    const own = historyBy.get(a.id) ?? [];
    const asOf = String(a.created_at ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const coverage = employmentCoverage(own.map(toPeriod), asOf);
    // Segment A only. §391.21(b)(11) asks for CMV jobs alone, so a stretch without one is
    // somebody who was not driving, and a pipeline that chased it would chase every applicant.
    const gapDays = coverage.segmentA.gaps.reduce((sum, g) => sum + g.days, 0);
    const invite = inviteBy.get(a.id) ?? null;
    const progress = applicantProgress({
      employerCount: own.length,
      gapDays,
      authorizations: authsBy.get(a.id) ?? [],
      application: invite
        ? {
            applicationSentAt: invite.application_sent_at,
            reviewRequestedAt: invite.review_requested_at,
            approvedAt: invite.approved_at,
            signingOpenedAt: invite.signing_opened_at,
            submittedAt: invite.submitted_at,
          }
        : null,
      hasDraft: invite ? draftFor.has(invite.id) : false,
    });
    return {
      driver_id: a.id,
      full_name: a.full_name,
      applied_on: asOf,
      // Whether they can be screened at all — the value never leaves the roster API.
      date_of_birth_recorded: Boolean(a.date_of_birth),
      employers: own.length,
      employers_in_window: coverage.segmentA.employers,
      cmv_employers: coverage.segmentB.cmvEmployers,
      gap_days: gapDays,
      stage: progress.stage,
      outstanding: progress.outstanding,
      releases_complete: progress.releasesComplete,
      // ⚠ The NEWEST decision, not the first: the table is append-only, so a carrier who
      // declines and then changes its mind records a second row. `currentDisposition` is shared
      // with the driver page so the board and the file cannot answer this differently.
      disposition: currentDisposition(decisionsBy.get(a.id) ?? []),
      // The board's five columns since B4. Always present — the fold answers for an applicant
      // who has done nothing as readily as for one who has done everything.
      checklist: checklists.get(a.id) ?? null,
    };
  });

  res.json({ applicants: rows });
});
