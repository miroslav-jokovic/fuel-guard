import type { SupabaseClient } from "@supabase/supabase-js";
import { applicantsToQuery, ASSISTANT_TOOL_PAGE, HIRING_PHASE_LABELS, type HiringPhase } from "@silvicom/shared";
import { readApplicantPipeline } from "./routes/employmentPipeline.js";

/**
 * The assistant's `recruiting_counts` tool (F21 R6b, 2026-11-10): the Applicants board
 * (`/recruitment`), asked in words ("how many applicants are waiting on us", "who has been stuck the
 * longest").
 *
 * ── WHY IT CALLS `readApplicantPipeline` AND NOTHING ELSE ────────────────────────────────────────
 * `GET /api/recruitment/pipeline` is `readApplicantPipeline` (moved out of its handler for this tool,
 * same queries and rows): each applicant with the hiring checklist folded on the server
 * (`boardChecklists`): the phase, who it waits on, the next step's words, days waiting, ready to
 * screen. The board's option labels count exactly those fields ("Waiting on you (N)" is
 * `checklist.waiting_on === "us"`, `countWaitingOn`; "Ready to screen (N)" is
 * `checklist.ready_to_screen`), so this file counts the same fields over the same rows. It never
 * judges a step itself.
 *
 * ── STATUSES ONLY (D-AI7) ────────────────────────────────────────────────────────────────────────
 * A name, a phase, who it waits on, the next step and how long: nothing an application holds. Not the
 * date of birth (the board carries only whether it is recorded, and this drops even that), not gaps
 * in employment, and not a decision's REASON, which can rest on a consumer report (FCRA). A decision
 * is given only as its outcome.
 *
 * Gated as its page is: `recruitment: view` (`assistantContract.ts`). The default board: archived
 * applicants are left out, as the page's first view leaves them out.
 *
 * ORG-SCOPED: every read in `readApplicantPipeline` filters `org_id`.
 */

export const RECRUITING_SOURCE = "Applicants board (/recruitment), the same stages and queues that board shows";
export const RECRUITING_WAITING = ["us", "them"] as const;
export const MAX_RECRUITING_ROWS = 25;

export interface AssistantRecruitingInput {
  waiting_on?: unknown;
  phase?: unknown;
}

export async function assistantRecruiting(admin: SupabaseClient, orgId: string, input: AssistantRecruitingInput): Promise<unknown> {
  const result = await readApplicantPipeline(admin, orgId);
  if (!result.ok) throw new Error(result.message);
  const board = result.applicants;

  const by_stage: Record<string, number> = {};
  for (const a of board) {
    const label = a.checklist?.phase ? HIRING_PHASE_LABELS[a.checklist.phase] : "Nothing outstanding";
    by_stage[label] = (by_stage[label] ?? 0) + 1;
  }
  const decided: Record<string, number> = {};
  for (const a of board) if (a.disposition) decided[a.disposition.outcome] = (decided[a.disposition.outcome] ?? 0) + 1;

  const waiting = (RECRUITING_WAITING as readonly string[]).includes(String(input.waiting_on)) ? String(input.waiting_on) : null;
  const phase = Object.keys(HIRING_PHASE_LABELS).includes(String(input.phase)) ? (input.phase as HiringPhase) : null;
  // The board's own default order: longest waiting first (Q-HUI4, `SORT_DEFAULT`), unmeasured last.
  const rows = board
    .filter((a) => (!waiting || a.checklist?.waiting_on === waiting) && (!phase || a.checklist?.phase === phase))
    .sort((a, b) => (b.checklist?.days_waiting ?? -1) - (a.checklist?.days_waiting ?? -1));

  return {
    source: RECRUITING_SOURCE,
    applicants_on_the_board: board.length,
    waiting_on_us: board.filter((a) => a.checklist?.waiting_on === "us").length,
    waiting_on_them: board.filter((a) => a.checklist?.waiting_on === "them").length,
    ready_to_screen: board.filter((a) => a.checklist?.ready_to_screen === true).length,
    by_stage,
    decided,
    applicants: rows.slice(0, MAX_RECRUITING_ROWS).map((a) => ({
      applicant: a.full_name,
      applied_on: a.applied_on,
      stage: a.checklist?.phase ? HIRING_PHASE_LABELS[a.checklist.phase] : null,
      waiting_on: a.checklist?.waiting_on ?? null,
      next_step: a.checklist?.next_label ?? null,
      days_waiting: a.checklist?.days_waiting ?? null,
      steps_done: a.checklist ? `${a.checklist.done} of ${a.checklist.total}` : null,
      decision: a.disposition?.outcome ?? null,
    })),
    ...(rows.length > MAX_RECRUITING_ROWS ? { applicants_note: `${MAX_RECRUITING_ROWS} of ${rows.length} applicants listed, longest waiting first.` } : {}),
    // F21 R4b: the board opened on this answer's queue and stage; "everybody" is written `any`, since the
    // board opens on "waiting on you". Lifted off before the model sees the result (D-AI8).
    link: { surfaceKey: ASSISTANT_TOOL_PAGE.recruiting_counts, query: applicantsToQuery({ waiting: waiting as "us" | "them" | null, phase }) },
  };
}
