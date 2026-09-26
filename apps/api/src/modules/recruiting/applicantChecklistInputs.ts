import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countedPacketMarks,
  driverInquiryQueue,
  handbookStatus,
  roadTestCounts,
  type AuthorizationRow,
  type HiringChecklistInputs,
} from "@silvicom/shared";
import { driversWithPspRequest } from "../psp/index.js";
import {
  readDraftFacts,
  readEmploymentHistory,
  readHandbookMarks,
  readInquiries,
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

  const [records, pspRequested, marks, drafts, employment, inquiries, handbookMarks] = await Promise.all([
    readQualificationRecords(admin, orgId, driverIds),
    // ⚠ Through the psp module's own interface, never `psp_requests` directly: that table is its
    // (D-SEP1) and `lint:table-access` refuses a raw read from recruitment.
    driversWithPspRequest(admin, orgId, driverIds),
    readPacketMarks(admin, orgId, invitationIds),
    readDraftFacts(admin, orgId, invitationIds),
    readEmploymentHistory(admin, orgId, driverIds),
    readInquiries(admin, orgId, driverIds),
    readHandbookMarks(admin, orgId, invitationIds),
  ]);

  for (const s of subjects) {
    const own = records.get(s.driverId) ?? [];
    const kinds = [...new Set(own.map((r) => r.kind))];
    const inv = s.invitation;
    const markRows = inv ? (marks.get(inv.id) ?? []) : [];
    const draft = inv ? drafts.get(inv.id) : undefined;
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
      hasDraft: draft !== undefined,
      authorizations: s.authorizations,
      releasesCompletedAt: inv?.releases_completed_at ?? null,
      qualificationKinds: kinds,
      mvrJurisdictions: own.filter((r) => r.kind === "mvr").map((r) => r.jurisdiction ?? null),
      // A-8: a road test counts when the ceremony filed it or it says it was passed — on the board too.
      roadTestPassed: own.some((r) => r.kind === "road_test" && roadTestCounts(r)),
      licenceJurisdictions: draft?.licenceJurisdictions ?? [],
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
