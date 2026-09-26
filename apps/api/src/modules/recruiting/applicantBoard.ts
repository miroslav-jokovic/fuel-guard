import type { SupabaseClient } from "@supabase/supabase-js";
import { hiringChecklist, hiringStep, type HiringPhase, type HiringStepKey } from "@silvicom/shared";
import { checklistInputs, type ChecklistInvitation, type ChecklistSubject } from "./applicantChecklistInputs.js";
import type { MarkRow, QualificationRow } from "./applicantBoardReads.js";

/**
 * The board's half of the fold — every applicant's checklist in one pass (B4, `HIRING-MODULE-PLAN.md` §9).
 *
 * ── WHY THIS IS NOT A LOOP OVER `applicantChecklist` ──────────────────────────────────────────
 * Calling the one-applicant checklist per row would make the board cost a round trip per table per
 * applicant, and the board is the screen a recruiter leaves open — `docs/plans/livemap/
 * LIVE-MAP-CONCURRENCY-PLAN.md` §7 is what that costs when it is wrong, and the repair (#856–#858)
 * was three PRs. So the evidence is read set-based, one `.in()` per table for the whole board, and
 * since G-7 (2026-09-26) by the SAME builder the drawer uses — `applicantChecklistInputs.ts`, which
 * says what the two separate builders had drifted into.
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
export interface BoardApplicantInput extends ChecklistSubject {
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

/** The live invitation, as the board's caller chose it (newest, not revoked). */
export type BoardInvitation = ChecklistInvitation;

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
): Promise<{ checklists: Map<string, BoardChecklist>; drafted: Set<string> }> {
  const checklists = new Map<string, BoardChecklist>();
  /**
   * The drivers whose live invitation has a draft — handed back because the pipeline's own stage
   * column asks the same question, and answering it from THIS read is what keeps the board's two
   * columns from reading the drafts twice and disagreeing (F5).
   */
  const drafted = new Set<string>();
  if (applicants.length === 0) return { checklists, drafted };

  // ⚠ Derived from `now` rather than read separately, so the whole board is folded against ONE
  // instant. Two clock reads in one pass is how a row at a midnight boundary comes out measured
  // against a different day from the row above it.
  const today = now.toISOString().slice(0, 10);
  const evidence = await checklistInputs(admin, orgId, applicants, today);

  for (const a of applicants) {
    const { inputs, records, marks } = evidence.get(a.driverId)!;
    if (inputs.hasDraft) drafted.add(a.driverId);
    const checklist = hiringChecklist(inputs);

    // The fold emits only measurable steps and nominates `next` from among them, so this always
    // finds one when `next` is set.
    const next = checklist.next;
    const nextStep = checklist.steps.find((s) => s.key === next) ?? null;
    const lastProgressAt = newestEvidence(a, records, marks);

    checklists.set(a.driverId, {
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

  return { checklists, drafted };
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
