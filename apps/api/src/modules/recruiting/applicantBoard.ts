import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countedPacketMarks,
  driverInquiryQueue,
  hiringChecklist,
  hiringStep,
  type ApplyingAs,
  type AuthorizationRow,
  type HiringPhase,
  type HiringStepKey,
  type QueueAttempt,
  type QueueEmployment,
} from "@silvicom/shared";
import { driversWithPspRequest } from "../psp/index.js";
import { RECORD_JURISDICTION_SELECT } from "./applicantLicences.js";

/**
 * The board's half of the fold — every applicant's checklist in one pass (B4, `HIRING-MODULE-PLAN.md` §9).
 *
 * ── WHY THIS IS NOT A LOOP OVER `applicantChecklist` ──────────────────────────────────────────
 * B3 answers for ONE applicant and does seven round trips to do it. Calling it per row would make
 * the board cost seven queries per applicant, and the board is the screen a recruiter leaves open —
 * `docs/plans/livemap/LIVE-MAP-CONCURRENCY-PLAN.md` §7 is what that costs when it is wrong, and the
 * repair (#856–#858) was three PRs. So this reads set-based: three `.in()` queries for the whole
 * org, grouped in memory, then the same pure fold per row. Three queries at 2 applicants and three
 * at 2,000.
 *
 * ── AND IT DECIDES NOTHING, FOR B3'S REASON ───────────────────────────────────────────────────
 * ⚠ Every rule about what a step means is `hiringChecklist.ts`'s. What is added here is a PROJECTION
 * — the five things §4.1's columns show — and the projection is deliberately lossy: a board that
 * shipped all fifteen steps per row would be handing the page a decision about which one to lead
 * with, and the fold has already made it (`next`).
 *
 * ── THE SERVICE ROLE BYPASSES RLS ─────────────────────────────────────────────────────────────
 * ⚠ Every read below carries its own `.eq("org_id", …)`, and `applicantBoard.test.ts` asserts it
 * through `supabaseRecorder`'s `expectOrgScoped`.
 */

/** What the caller already read, per driver. Passed in rather than re-queried — see `boardChecklists`. */
export interface BoardApplicantInput {
  driverId: string;
  hiredAt: string | null;
  /**
   * The LIVE invitation — newest, not revoked.
   *
   * ⚠ Chosen by the caller rather than here, so that the board and the pipeline stage beside it
   * cannot pick different invitations for the same person and then disagree in adjacent columns.
   */
  invitation: BoardInvitation | null;
  hasDraft: boolean;
  /**
   * What the draft says they are applying as (Q-HM14), read by the caller with the draft flag above
   * and for the same reason — one read of the draft, two answers from it. Decides how many places
   * this applicant's packet has.
   */
  applyingAs: ApplyingAs | null;
  /**
   * The licensing jurisdictions the same draft declares (AF7, `declaredLicenceJurisdictions`), read
   * in that one draft read. Empty while none is known.
   */
  licenceJurisdictions: readonly string[];
  authorizations: readonly AuthorizationRow[];
  /**
   * Has the carrier already answered this application — declined, withdrawn, no response (0238)?
   *
   * ⚠ **A decided applicant is waiting on NOBODY, and this flag is the whole of that rule.** Their
   * checklist is still full of genuinely outstanding steps, so the fold rightly keeps reporting
   * them; what must not happen is the BOARD counting them into *waiting on you*. Measured by
   * looking at the board on 2026-09-18: a declined applicant sat at the top of the default view,
   * sixteen days stale, in a column headed by the question *what is mine today*. The page already
   * refused to print a next action for them — `RecruitmentPage.vue`'s own comment says a stale
   * sentence about somebody the carrier already answered *"is what would send the next recruiter to
   * chase them"* — but the filter and the counts had no such rule, so the row was invisible and
   * counted. One answer, at the projection, rather than a second rule in the page.
   */
  decided: boolean;
}

export interface BoardInvitation {
  id: string;
  created_at: string;
  /** AF4 (0365): when the office sent the application form. */
  application_sent_at: string | null;
  review_requested_at: string | null;
  approved_at: string | null;
  /** AF5 (0369): when the office opened packet signing, in person. */
  signing_opened_at: string | null;
  submitted_at: string | null;
}

/**
 * One row's worth of checklist — §4.1's columns and nothing else.
 *
 * ⚠ `blocked` is absent on purpose and its absence is a measurement, not an omission. `next` is the
 * first step that is neither done nor blocked, so a row can only have no `next` when every
 * measurable step is done: a step that blocks is always preceded by the unmet step that blocks it,
 * which is itself unblocked and therefore nominated first. The mockup's "Blocked" stage badge
 * cannot arise from the fold, so the board does not offer a filter that would always return zero.
 * Blocked steps are real and belong on the applicant's own checklist (B5), a row at a time.
 */
export interface BoardChecklist {
  /** The one action to lead with. Null only when every measurable step is done. */
  next: HiringStepKey | null;
  /** Its plain words, resolved from the catalogue so the page never restates a label. */
  next_label: string | null;
  /** The Stage column: the phase of the step they are waiting on, never of the last one finished. */
  phase: HiringPhase | null;
  /** The Waiting-on column. `null` means nobody — there is nothing outstanding. */
  waiting_on: "us" | "them" | null;
  done: number;
  total: number;
  /**
   * How long this has sat still, in whole days.
   *
   * ⚠ Named for what it MEASURES rather than for §4.1's "days in stage", because the two are only
   * usually the same number and the difference matters to whoever reads it next. What the evidence
   * can date is when a step last COMPLETED; a stage boundary is one of those moments but not the
   * only one, so "days in stage" would be a claim this data cannot make. Q-HUI4 ruled the column in
   * to answer the one question a kanban asks — *what is going stale* — and this answers that.
   */
  days_waiting: number;
  /** The timestamp `days_waiting` counts from: the newest evidence of any kind, or the invitation. */
  last_progress_at: string | null;
}

/**
 * Fold every applicant on the board.
 *
 * `now` is a parameter rather than a `new Date()` inside, for this repo's usual reason: a day count
 * that reads the clock is a function whose tests can only be written at a particular hour.
 */
export async function boardChecklists(
  admin: SupabaseClient,
  orgId: string,
  applicants: readonly BoardApplicantInput[],
  now: Date = new Date(),
): Promise<Map<string, BoardChecklist>> {
  const out = new Map<string, BoardChecklist>();
  if (applicants.length === 0) return out;

  const driverIds = applicants.map((a) => a.driverId);
  const invitationIds = applicants.map((a) => a.invitation?.id).filter((id): id is string => Boolean(id));

  const [records, pspRequested, marks, employment, inquiries] = await Promise.all([
    readQualificationRecords(admin, orgId, driverIds),
    // ⚠ Through the psp module's own interface, never `psp_requests` directly: that table is its
    // (D-SEP1) and `lint:table-access` refuses a raw read from recruitment — which is exactly what
    // it did to B3, correctly.
    driversWithPspRequest(admin, orgId, driverIds),
    readPacketMarks(admin, orgId, invitationIds),
    // ⚠ Q-HM9's two, and they keep this function's shape rather than breaking it: five `.in()`
    // queries for the whole org, grouped in memory, still three-plus-two regardless of whether the
    // board holds two applicants or two thousand. Folding the investigation per driver here would
    // have been the N+1 this module's header exists to refuse.
    readEmploymentHistory(admin, orgId, driverIds),
    readInquiries(admin, orgId, driverIds),
  ]);

  // ⚠ Derived from `now` rather than read separately, so the whole board is folded against ONE
  // instant. Two clock reads in one pass is how a row at a midnight boundary comes out measured
  // against a different day from the row above it.
  const today = now.toISOString().slice(0, 10);

  for (const a of applicants) {
    const own = records.get(a.driverId) ?? [];
    const kinds = [...new Set(own.map((r) => r.kind))];
    const markRows = a.invitation ? (marks.get(a.invitation.id) ?? []) : [];
    const attempts = inquiries.get(a.driverId) ?? [];
    // ⚠ The same pure fold the single-applicant checklist uses (`applicantChecklist.ts`), for D-HM2's
    // reason: the board and the applicant's own record must never disagree about whether the §391.23
    // investigation is outstanding.
    const investigationQueue = driverInquiryQueue({
      employment: employment.get(a.driverId) ?? [],
      attempts,
      hireDate: a.hiredAt,
      today,
    });

    const checklist = hiringChecklist({
      invitedAt: a.invitation?.created_at ?? null,
      phases: a.invitation
        ? {
            applicationSentAt: a.invitation.application_sent_at,
            reviewRequestedAt: a.invitation.review_requested_at,
            approvedAt: a.invitation.approved_at,
            signingOpenedAt: a.invitation.signing_opened_at,
            submittedAt: a.invitation.submitted_at,
          }
        : null,
      hasDraft: a.hasDraft,
      authorizations: a.authorizations,
      qualificationKinds: kinds,
      mvrJurisdictions: own.filter((r) => r.kind === "mvr").map((r) => r.jurisdiction ?? null),
      licenceJurisdictions: a.licenceJurisdictions,
      psp: {
        requested: pspRequested.has(a.driverId),
        // ⚠ The REPORT, not the order (B3): `/psp-imports` files one bought on FMCSA's portal and it
        // ticks this step exactly as an ordered one does. D-HM6 read from the evidence side.
        reportReceived: kinds.includes("psp_report"),
      },
      // ⚠ Marks at THIS applicant's current stops only — a mark on a withdrawn line (L-1), or a p31b
      // from somebody who is now a company driver (Q-HM14), is still a row.
      packetMarks: countedPacketMarks(markRows.map((r) => r.placement_id), a.applyingAs),
      applyingAs: a.applyingAs,
      investigation: {
        outstanding: investigationQueue.outstanding.length,
        // ⚠ `awaiting` only — the employer's own move. See `applicantChecklist.ts`'s note.
        awaiting: investigationQueue.outstanding.filter((e) => e.state === "awaiting").length,
      },
      hiredAt: a.hiredAt,
    });

    // The fold emits only measurable steps and nominates `next` from among them, so this always
    // finds one when `next` is set.
    const next = checklist.next;
    const nextStep = checklist.steps.find((s) => s.key === next) ?? null;
    const lastProgressAt = newestEvidence(a, own, markRows);

    out.set(a.driverId, {
      next,
      // ⚠ `action`, not `label`: this column is an instruction. See `HiringStepSpec.action`.
      next_label: next ? hiringStep(next).action : null,
      phase: next ? hiringStep(next).phase : null,
      // ⚠ Read off the FOLD's state rather than off the catalogue's `owes`. They agree while a step
      // has not started, and they stop agreeing the moment one is in flight: PSP that has been
      // ordered is `owes: "us"` in the catalogue and `waiting_on_them` in the fold, and the fold is
      // the one that is right — the office has done its part and is now chasing a vendor.
      //
      // ⚠ And a DECIDED application is waiting on nobody, whatever its steps say. See `decided`.
      waiting_on: a.decided ? null : nextStep?.state === "waiting_on_us" ? "us" : nextStep ? "them" : null,
      done: checklist.done,
      total: checklist.total,
      days_waiting: wholeDaysBetween(lastProgressAt, now),
      last_progress_at: lastProgressAt,
    });
  }

  return out;
}

/**
 * When something last happened, across every kind of evidence the fold reads.
 *
 * ⚠ Not "when the application was created", which is what a naive board shows and is the number that
 * makes a recruiter ignore the column: an applicant invited in March who finished their drug test
 * yesterday is not 180 days stale. The invitation is the FLOOR, used when nothing else has landed.
 */
function newestEvidence(
  a: BoardApplicantInput,
  records: readonly QualificationRow[],
  marks: readonly MarkRow[],
): string | null {
  const stamps: Array<string | null | undefined> = [
    a.invitation?.created_at,
    a.invitation?.review_requested_at,
    a.invitation?.approved_at,
    a.invitation?.submitted_at,
    a.hiredAt,
    ...a.authorizations.map((r) => r.accepted_at),
    ...records.map((r) => r.created_at),
    ...marks.map((r) => r.created_at),
  ];
  let newest: string | null = null;
  for (const s of stamps) {
    if (!s) continue;
    if (newest === null || s > newest) newest = s;
  }
  return newest;
}

/** Whole days, floored — a row that moved four hours ago reads 0, which is what "today" means here. */
function wholeDaysBetween(from: string | null, now: Date): number {
  if (!from) return 0;
  const started = Date.parse(from);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now.getTime() - started) / 86_400_000));
}

interface QualificationRow {
  driver_id: string;
  kind: string;
  created_at: string;
  /** AF7: `detail.jurisdiction`, by path. Null on anything but a recorded MVR that named one. */
  jurisdiction?: string | null;
}

interface MarkRow {
  invitation_id: string;
  placement_id: string;
  created_at: string;
}

/**
 * Every §391.51 event for every applicant, in one query.
 *
 * ⚠ `created_at` as well as `kind`, and only because `days_waiting` needs a date. Recurrence and
 * expiry still belong to `dqCatalogue.ts` — nothing here forms an opinion about when an MVR goes
 * stale, which is the second opinion B3's own comment refused to invite.
 */
async function readQualificationRecords(
  admin: SupabaseClient,
  orgId: string,
  driverIds: readonly string[],
): Promise<Map<string, QualificationRow[]>> {
  const { data } = await admin
    .from("qualification_records")
    .select(`driver_id, kind, created_at, ${RECORD_JURISDICTION_SELECT}`)
    .eq("org_id", orgId)
    .in("driver_id", driverIds);
  return groupBy((data ?? []) as QualificationRow[], (r) => r.driver_id);
}

/**
 * The packet places collected, per invitation.
 *
 * ⚠ Keyed on the INVITATION, never the driver — 0339 scopes them that way because a rehire signs
 * their own packet and the two must not merge. A driver-keyed count adds last year's twenty-two to
 * this year's none and reports a packet signed that nobody has opened.
 */
async function readPacketMarks(
  admin: SupabaseClient,
  orgId: string,
  invitationIds: readonly string[],
): Promise<Map<string, MarkRow[]>> {
  if (invitationIds.length === 0) return new Map();
  const { data } = await admin
    .from("application_packet_marks")
    .select("invitation_id, placement_id, created_at")
    .eq("org_id", orgId)
    .in("invitation_id", invitationIds);
  return groupBy((data ?? []) as MarkRow[], (r) => r.invitation_id);
}

/**
 * The declared §391.21(b)(10) employment history, per driver (Q-HM9).
 *
 * ⚠ Read whole rather than counted, because `driverInquiryQueue` decides which of these employers
 * are actually owed an inquiry — DOT-regulated, and inside the §391.23(a)(2) three-year window
 * measured from the hire date. A `count` here could not answer either question, and a `.eq` on
 * `dot_regulated` would be this module forming the opinion its own header says it must not.
 */
async function readEmploymentHistory(
  admin: SupabaseClient,
  orgId: string,
  driverIds: readonly string[],
): Promise<Map<string, QueueEmployment[]>> {
  const { data } = await admin
    .from("driver_employment_history")
    .select("id, driver_id, employer_name, started_on, ended_on, dot_regulated")
    .eq("org_id", orgId)
    .in("driver_id", driverIds);
  const out = new Map<string, QueueEmployment[]>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const driverId = String(row.driver_id);
    const list = out.get(driverId) ?? [];
    list.push({
      id: String(row.id),
      employerName: String(row.employer_name),
      startedOn: String(row.started_on),
      endedOn: (row.ended_on as string | null) ?? null,
      dotRegulated: Boolean(row.dot_regulated),
    });
    out.set(driverId, list);
  }
  return out;
}

/**
 * The §391.23(c)(2) contact attempts, per driver (Q-HM9).
 *
 * ⚠ `safety_performance` only, matching `loadInquiryQueue` and `applicantChecklist`: `drug_alcohol`
 * is §40.25 and applies to non-FMCSA DOT safety-sensitive employment, which §391.23(e) routes to the
 * Clearinghouse instead. Counting it would hold this step open against an inquiry nobody owes.
 */
async function readInquiries(
  admin: SupabaseClient,
  orgId: string,
  driverIds: readonly string[],
): Promise<Map<string, QueueAttempt[]>> {
  const { data } = await admin
    .from("employer_inquiries")
    .select("driver_id, employment_id, contacted_on, outcome")
    .eq("org_id", orgId)
    .eq("kind", "safety_performance")
    .in("driver_id", driverIds);
  const out = new Map<string, QueueAttempt[]>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const driverId = String(row.driver_id);
    const list = out.get(driverId) ?? [];
    list.push({
      employmentId: String(row.employment_id),
      contactedOn: String(row.contacted_on),
      outcome: row.outcome as QueueAttempt["outcome"],
    });
    out.set(driverId, list);
  }
  return out;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(key(row));
    if (list) list.push(row);
    else out.set(key(row), [row]);
  }
  return out;
}
