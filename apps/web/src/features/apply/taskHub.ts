import {
  APPLICATION_CAPTURE_REQUESTED,
  APPLICATION_FILLING_SECTIONS,
  APPLICATION_SECTION_KEYS,
  APPLICATION_SECTION_LABELS,
  type ApplicationCaptureView,
  type ApplicationSection,
} from "@silvicom/shared";
import { emptyDraft, toApplication, type ApplicationDraft } from "./draft";
import { validateSection } from "./useApplicationWizard";
import { APPLY_COPY } from "./strings";

/**
 * Part 2 as a task list (APPLICATION-FLOW-V2-PLAN.md §6.4, D-AW11, C3c2a) — which tasks there are, and
 * where each stands.
 *
 * ── THE STATUS IS DERIVED, NEVER STORED ───────────────────────────────────────────────────────
 * Every status is read off the draft by the same two rules that already judge it: the server's own
 * schema per screen plus a v2 filing's rules (`validateSection`, C3c1), and "is there anything here
 * that would be filed" (`toApplication`, which drops the blank rows an accidental "Add" leaves). So a
 * task reads Completed exactly when its screen would let the driver past, and nothing can say Completed
 * about an answer the filing would refuse. A stored status would be a second opinion that drifts.
 *
 *   Not started — nothing on it would be filed.
 *   In progress — something would, and the screen would not let them past yet.
 *   Completed   — something would, and it would let them past.
 *   Cannot start yet — "Before you send", until every required task passes.
 *
 * ── TWO TASKS NEVER HOLD ANYTHING UP ──────────────────────────────────────────────────────────
 * The carrier's own questions discharge no §391.21 paragraph and are optional by D-APP12; the
 * photographs are optional by A8 (the CDL's two were taken in Part 1). Both show their status and are
 * marked optional; untouched, both pass, so "Before you send" never waits on them being done — only on
 * nothing in them being wrong.
 */

export type TaskStatus = "not_started" | "in_progress" | "completed" | "cannot_start";

export interface HubTask {
  section: ApplicationSection;
  label: string;
  status: TaskStatus;
  optional: boolean;
}

/** The tasks that never gate "Before you send" — see the header. */
export const OPTIONAL_TASKS: readonly ApplicationSection[] = ["questions", "documents"];

/** The last row, and the only one that can be shut. */
export const SEND_TASK: ApplicationSection = "review";

const EMPTY = toApplication(emptyDraft()) as Record<string, unknown>;

/** Would anything on this screen be filed? Compared on the filed shape, so blank rows do not count. */
function touched(section: ApplicationSection, filed: Record<string, unknown>): boolean {
  return APPLICATION_SECTION_KEYS[section].some((key) => JSON.stringify(filed[key]) !== JSON.stringify(EMPTY[key]));
}

/** The photographs' own status: how many of the requested slots are on file. */
function documentsStatus(captures: readonly ApplicationCaptureView[]): TaskStatus {
  const have = APPLICATION_CAPTURE_REQUESTED.filter((slot) => captures.some((c) => c.slot === slot)).length;
  if (have === 0) return "not_started";
  return have === APPLICATION_CAPTURE_REQUESTED.length ? "completed" : "in_progress";
}

export function taskStatus(
  section: ApplicationSection,
  draft: ApplicationDraft,
  v2AsOf: string | null,
  captures: readonly ApplicationCaptureView[],
): TaskStatus {
  if (section === "documents") return documentsStatus(captures);
  const filed = toApplication(draft) as Record<string, unknown>;
  if (!touched(section, filed)) return "not_started";
  return validateSection(section, draft, v2AsOf).length === 0 ? "completed" : "in_progress";
}

/** Every task, in the order §6.4 lists them, ending with "Before you send". */
export function hubTasks(
  draft: ApplicationDraft,
  v2AsOf: string | null,
  captures: readonly ApplicationCaptureView[],
): HubTask[] {
  const work = APPLICATION_FILLING_SECTIONS.filter((s) => s !== SEND_TASK).map((section) => ({
    section,
    label: APPLICATION_SECTION_LABELS[section],
    status: taskStatus(section, draft, v2AsOf, captures),
    optional: OPTIONAL_TASKS.includes(section),
  }));
  /**
   * ⚠ Gated on PASSING, not on the Completed status, and on EVERY task: an optional task nobody touched is
   * Not started and passes, because nothing on it is required. Today neither optional screen can fail
   * (the carrier's answers are `record<unknown>`, the photographs own no field), so an exemption for them
   * changed nothing — and it would have opened this row onto a filing refusal the day a carrier question
   * gains a rule. Same `validateSection` the Send button's summary is built from.
   */
  const ready = work.every((t) => validateSection(t.section, draft, v2AsOf).length === 0);
  return [...work, { section: SEND_TASK, label: APPLY_COPY.hub.beforeYouSend, status: ready ? "not_started" : "cannot_start", optional: false }];
}
