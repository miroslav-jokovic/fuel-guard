import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countedPacketMarks,
  driverInquiryQueue,
  handbookStatus,
  mvrFreshSince,
  roadTestCounts,
  type AuthorizationRow,
  type HiringChecklistInputs,
} from "@silvicom/shared";
import { driversWithPspRequest } from "../psp/index.js";
import {
  readCarrierZone,
  readDraftFacts,
  readDriverRowFacts,
  readEmploymentHistory,
  readHandbookMarks,
  readInquiries,
  readIntakeInvitations,
  readIntakeLicences,
  readLiveTravel,
  readPacketMarks,
  readQualificationRecords,
  type MarkRow,
  type QualificationRow,
} from "./applicantBoardReads.js";

/**
 * The ONE builder of `hiringChecklist`'s input — for the board's every row and the drawer's one
 * applicant alike (APPLICATION-FLOW-V2-PLAN G-7, 2026-09-26).
 *
 * ── WHY ONE, MEASURED ─────────────────────────────────────────────────────────────────────────
 * There were two: `applicantChecklist.ts` read one applicant in nine queries, `applicantBoard.ts`
 * read the whole board in six `.in()` queries, and each named the columns its own way. They agreed
 * until somebody changed one: A-8 taught the drawer that only a PASSED road test counts and A-4 that
 * a closed ceremony's missing permission is the office's — and the board learned neither, so the same
 * applicant read "road test done" on the board and "not done" in the drawer. D-HM2's rule, *the board
 * and the applicant's own record must never disagree*, was being kept by two copies and a comment.
 * Now the drawer is the board with one row: the same reads, the same mapping, and a field added to
 * the input is added here once, for both.
 *
 * ── SET-BASED, AND ORG-SCOPED ─────────────────────────────────────────────────────────────────
 * One `.in()` per evidence table for however many subjects — `applicantBoard.ts`'s header has the
 * cost argument — paged past PostgREST's 1,000-row answer (`applicantBoardReads.ts`). ⚠ The service
 * role bypasses RLS: every read carries its own `.eq("org_id", …)`, asserted by `expectOrgScoped` in
 * both callers' tests.
 *
 * ── WHAT THE CALLER BRINGS, AND WHY ───────────────────────────────────────────────────────────
 * The driver, the LIVE invitation and the authorizations. The board has already read all three for
 * its own stage column, and reading them again here would let two reads pick different invitations
 * for one person and disagree in adjacent columns (the pipeline's own note on it). The drawer reads
 * the same three first, the same way.
 */

/** The live invitation's stamps the fold reads — the newest unrevoked one, chosen by the caller. */
export interface ChecklistInvitation {
  id: string;
  created_at: string;
  /** A-4: when the link's permission ceremony closed. Optional for a row selected without it. */
  releases_completed_at?: string | null;
  /** §7: `complete_applicant_intake`'s stamp. Optional for a row selected without it. */
  intake_completed_at?: string | null;
  application_sent_at: string | null;
  review_requested_at: string | null;
  approved_at: string | null;
  signing_opened_at: string | null;
  submitted_at: string | null;
  handbook_signing_opened_at?: string | null;
}

export interface ChecklistSubject {
  driverId: string;
  hiredAt: string | null;
  invitation: ChecklistInvitation | null;
  authorizations: readonly AuthorizationRow[];
}

/** The fold's input, plus the dated rows the board's `days_waiting` reads — the same rows, not a re-read. */
export interface SubjectEvidence {
  inputs: HiringChecklistInputs;
  records: QualificationRow[];
  marks: MarkRow[];
}

/**
 * `today` is a parameter for the reason `applicantChecklist`'s signature gives: the §391.23(a)(2)
 * window is measured from the hire date or, for an applicant, from today, and a builder that read the
 * clock could only be tested at a particular hour.
 */
export async function checklistInputs(
  admin: SupabaseClient,
  orgId: string,
  subjects: readonly ChecklistSubject[],
  today: string,
): Promise<Map<string, SubjectEvidence>> {
  const out = new Map<string, SubjectEvidence>();
  if (subjects.length === 0) return out;

  const driverIds = subjects.map((s) => s.driverId);
  const invitationIds = subjects.map((s) => s.invitation?.id).filter((id): id is string => Boolean(id));

  const [
    records, pspRequested, marks, drafts, employment, inquiries, handbookMarks, intakes, travel, driverRows,
    intakeLicences, zone,
  ] = await Promise.all([
    readQualificationRecords(admin, orgId, driverIds),
    // ⚠ Through the psp module's own interface, never `psp_requests` directly: that table is its
    // (D-SEP1) and `lint:table-access` refuses a raw read from recruitment.
    driversWithPspRequest(admin, orgId, driverIds),
    readPacketMarks(admin, orgId, invitationIds),
    readDraftFacts(admin, orgId, invitationIds),
    readEmploymentHistory(admin, orgId, driverIds),
    readInquiries(admin, orgId, driverIds),
    readHandbookMarks(admin, orgId, invitationIds),
    readIntakeInvitations(admin, orgId, invitationIds),
    readLiveTravel(admin, orgId, invitationIds),
    readDriverRowFacts(admin, orgId, driverIds),
    readIntakeLicences(admin, orgId, invitationIds),
    readCarrierZone(admin, orgId),
  ]);

  for (const s of subjects) {
    const own = records.get(s.driverId) ?? [];
    const kinds = [...new Set(own.map((r) => r.kind))];
    const inv = s.invitation;
    const markRows = inv ? (marks.get(inv.id) ?? []) : [];
    const draft = inv ? drafts.get(inv.id) : undefined;
    const row = driverRows.get(s.driverId);
    const v2 = inv ? intakes.has(inv.id) : false;
    // `driverInquiryQueue` owns which employers are owed an inquiry and which are open — the window,
    // the DOT filter, and that a DOCUMENTED non-response is done (§391.23(c)(1)). Nothing here
    // second-guesses it.
    const queue = driverInquiryQueue({
      employment: employment.get(s.driverId) ?? [],
      attempts: inquiries.get(s.driverId) ?? [],
      hireDate: s.hiredAt,
      today,
    });

    const inputs: HiringChecklistInputs = {
      invitedAt: inv?.created_at ?? null,
      phases: inv
        ? {
            applicationSentAt: inv.application_sent_at,
            reviewRequestedAt: inv.review_requested_at,
            approvedAt: inv.approved_at,
            signingOpenedAt: inv.signing_opened_at,
            submittedAt: inv.submitted_at,
          }
        : null,
      // §7: a v2 link is one with a Part 1 row; the fold applies the legacy rule to the rest.
      intake: inv ? { v2, completedAt: inv.intake_completed_at ?? null } : null,
      identityOnFile: row?.identityWhole === true,
      travelBooked: inv ? travel.has(inv.id) : false,
      hasDraft: draft !== undefined,
      authorizations: s.authorizations,
      releasesCompletedAt: inv?.releases_completed_at ?? null,
      qualificationKinds: kinds,
      mvrs: own
        .filter((r) => r.kind === "mvr")
        .map((r) => ({ jurisdiction: r.jurisdiction ?? null, occurredOn: r.occurred_on })),
      // G-3: thirty days before Part 1 finished — or, on a legacy link, before it was sent. A v2 link
      // whose Part 1 is still open has no floor yet, and its MVR is not orderable before Part 1 anyway.
      mvrFreshSince: mvrFreshSince(v2 ? inv?.intake_completed_at : inv?.created_at, zone),
      // A-8: a road test counts when the ceremony filed it or it says it was passed — on the board too.
      roadTestPassed: own.some((r) => r.kind === "road_test" && roadTestCounts(r)),
      licenceJurisdictions: licenceJurisdictionsOf(
        inv ? intakeLicences.get(inv.id) : undefined, draft?.licenceJurisdictions, row?.cdlState ?? null,
      ),
      psp: {
        requested: pspRequested.has(s.driverId),
        // ⚠ The REPORT, not the order: `/psp-imports` files one bought on FMCSA's portal and it ticks
        // the step exactly as an ordered one does (D-HM6, read from the evidence side).
        reportReceived: kinds.includes("psp_report"),
      },
      // ⚠ Marks at THIS applicant's stops (Q-HM14) and never the row count (L-1): a mark on a
      // withdrawn line is still a row.
      packetMarks: countedPacketMarks(markRows.map((r) => r.placement_id), draft?.applyingAs ?? null),
      applyingAs: draft?.applyingAs ?? null,
      investigation: {
        outstanding: queue.outstanding.length,
        // ⚠ `awaiting` only — the employer's own move. `not_sent`, `overdue` and `undeliverable` are
        // the office's (`hiringChecklist.ts`'s note on the row that shipped saying otherwise).
        awaiting: queue.outstanding.filter((e) => e.state === "awaiting").length,
      },
      // HANDBOOK-SIGNING-PLAN.md: drives only `inFlight`; the step is done on the filed record.
      handbook: {
        openedAt: inv?.handbook_signing_opened_at ?? null,
        driverComplete: handbookStatus({
          submittedAt: inv?.submitted_at ?? null,
          openedAt: inv?.handbook_signing_opened_at ?? null,
          filedAt: null,
          signedPlacementIds: inv ? (handbookMarks.get(inv.id) ?? []).map((r) => r.placement_id) : [],
        }).driverComplete,
      },
      hiredAt: s.hiredAt,
    };
    out.set(s.driverId, { inputs, records: own, marks: markRows });
  }
  return out;
}

/**
 * AW7: which licences this application owes an MVR for, from the most durable source that has any.
 *
 * 1. **Part 1's list** (`application_intake_licences`) — typed for exactly this, never pruned.
 * 2. **The live draft** — a legacy link's only list, pruned at 90 days (§2.3.2).
 * 3. **The licence state on the driver's row** — so a legacy applicant whose draft has been pruned, or
 *    who never had one, still owes the MVR of the state that licensed them rather than "any one MVR".
 *
 * ⚠ The first that has anything wins, never a union: Part 1's list is the applicant's answer to "every
 * licence in three years", and topping it up from an older draft would owe an MVR for a licence the
 * applicant has since corrected away. Measured 2026-09-26: every production draft names one state and
 * no additional licence, so the plan's legacy copy into `application_intake_licences` (§7) has nothing
 * to carry that source 3 does not already hold, and is not built.
 */
function licenceJurisdictionsOf(
  intake: readonly string[] | undefined,
  draft: readonly string[] | undefined,
  driverRowState: string | null,
): string[] {
  if (intake && intake.length > 0) return [...intake];
  if (draft && draft.length > 0) return [...draft];
  return driverRowState ? [driverRowState] : [];
}
