import type { HiringStep, HiringStepState } from "./hiringChecklist.js";
import type { HiringStepKey } from "./hiringStepGraph.js";

/**
 * The checklist as the office READS it — rows — over the checklist as the law MEASURES it — steps
 * (HIRING-WORKFLOW-AUDIT §14, D-OF1, owner 2026-11-03).
 *
 * ── WHY TWO LISTS AND NOT ONE ─────────────────────────────────────────────────────────────────
 * The owner read three pairs of rows as duplicates — Part 1 and its permissions, the driving record and
 * the medical card, the application and its approval — and each pair IS one act to the office. But each
 * half is a separate fact the product refuses or warns on by key: the medical card is one of §5's six
 * federal gates (`HIRE_REFUSES_WITHOUT`), the permissions are what an MVR order is refused without
 * (`REFUSING_STEPS`), the approval is what the packet's marks wait for (DR032). Deleting a half from the
 * catalogue would delete a gate; drawing it inside its partner's row deletes only the duplicate. So the
 * fold keeps every step, and this is the one place that groups them — every screen that lists the
 * hire reads this, never its own grouping.
 *
 * ⚠ Pure, and over the fold's OUTPUT: a step the fold did not emit (hidden by the carrier, unmeasurable)
 * is in no row, and a member whose host was not emitted is drawn as its own row rather than vanishing.
 */
export interface HiringChecklistRow {
  /** The host step's key — the row's identity, and the drawer it opens. */
  key: HiringStepKey;
  /** The host step's label: the row says what the office calls the act. */
  label: string;
  /** D-OF2: done when every member is; else "you" if the office can move on any; else them; else blocked. */
  state: HiringStepState;
  /** The host first, then the steps drawn inside it, in the catalogue's order. */
  steps: HiringStep[];
  /**
   * The member the row speaks for: the first not done (whose blocker, advice or missing states the third
   * column shows), or the host once all are done (whose artifact it links).
   */
  lead: HiringStep;
}

/** The order the merged states are read in: the loud one — the office's — wins (D-HUI4). */
const MERGED_PRECEDENCE: readonly HiringStepState[] = ["waiting_on_us", "waiting_on_them", "blocked"];

export function rowState(steps: readonly HiringStep[]): HiringStepState {
  if (steps.every((s) => s.state === "done")) return "done";
  return MERGED_PRECEDENCE.find((st) => steps.some((s) => s.state === st)) ?? "blocked";
}

export function hiringChecklistRows(steps: readonly HiringStep[]): HiringChecklistRow[] {
  const emitted = new Set(steps.map((s) => s.key));
  const rows: HiringChecklistRow[] = [];
  const byHost = new Map<HiringStepKey, HiringStep[]>();
  for (const step of steps) {
    if (step.listed === false) continue;
    const host = step.shownIn && emitted.has(step.shownIn) ? step.shownIn : step.key;
    const members = byHost.get(host);
    if (members) {
      members.push(step);
      continue;
    }
    const fresh = [step];
    byHost.set(host, fresh);
    rows.push({ key: host, label: step.label, state: step.state, steps: fresh, lead: step });
  }
  for (const row of rows) {
    row.state = rowState(row.steps);
    row.lead = row.steps.find((s) => s.state !== "done") ?? row.steps[0]!;
  }
  return rows;
}

/**
 * The row a step is drawn in — for a link that names a member (`?step=medical_certificate` from the
 * close drawer's list of federal checks) and must open the row that holds it. Null for an unlisted step.
 */
export function rowOfStep(rows: readonly HiringChecklistRow[], key: HiringStepKey): HiringChecklistRow | null {
  return rows.find((r) => r.steps.some((s) => s.key === key)) ?? null;
}

/**
 * The one action to lead with, read over ROWS: the first row neither done nor blocked, and inside it the
 * first member the office or the applicant can move on now. Never an unlisted step (D-OF3) — before §14
 * the investigation, off the list, would have been nominated as "Next" the day the application arrived.
 */
export function nextStepOf(rows: readonly HiringChecklistRow[]): HiringStepKey | null {
  const row = rows.find((r) => r.state !== "done" && r.state !== "blocked");
  return row?.steps.find((s) => s.state !== "done" && s.state !== "blocked")?.key ?? null;
}
