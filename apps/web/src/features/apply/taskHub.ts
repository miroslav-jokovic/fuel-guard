import {
  questionnaireProgress,
  APPLICATION_CAPTURE_REQUESTED,
  PART_ONE_CAPTURE_SLOTS,
  APPLICATION_FILLING_SECTIONS,
  APPLICATION_SECTION_KEYS,
  type ApplicationCaptureView,
  type ApplicationSection,
} from "@silvicom/shared";
import { emptyDraft, toApplication, type ApplicationDraft } from "./draft";
import { validateSection } from "./useApplicationWizard";
import { APPLY_COPY, APPLY_SECTION_TITLES } from "./strings";
import { applicantQuestionnaire } from "./questionnaireCopy";

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
 * ── ONE TASK NEVER HOLDS ANYTHING UP ──────────────────────────────────────────────────────────
 * The photographs are optional by A8 (the CDL's two were taken in Part 1): marked optional, and
 * untouched they pass, so "Before you send" never waits on them being done.
 *
 * ⚠ The carrier's own questions were the second until §9 P8 (AF-2). Marked "Optional" and passing
 * untouched, "Before you send" unlocked without anybody opening them — the audit measured the blank
 * answers that produced. Seven of them are required now (Q-WF3), so the task is held like any other,
 * and its row says how many of its questions are answered instead of "Optional".
 */

export type TaskStatus = "not_started" | "in_progress" | "completed" | "cannot_start";

export interface HubTask {
  section: ApplicationSection;
  label: string;
  status: TaskStatus;
  optional: boolean;
  /** How many of the task's questions are answered — the carrier's questions only (§9 P8, AF-2). */
  answered?: { answered: number; total: number };
}

/** The tasks that never gate "Before you send" — see the header. */
export const OPTIONAL_TASKS: readonly ApplicationSection[] = ["documents"];

/** The last row, and the only one that can be shut. */
export const SEND_TASK: ApplicationSection = "review";

const EMPTY = toApplication(emptyDraft()) as Record<string, unknown>;

/** Would anything on this screen be filed? Compared on the filed shape, so blank rows do not count. */
function touched(section: ApplicationSection, filed: Record<string, unknown>): boolean {
  return APPLICATION_SECTION_KEYS[section].some((key) => JSON.stringify(filed[key]) !== JSON.stringify(EMPTY[key]));
}

/**
 * The documents' own status (§9 P9). Every paper on the list is optional and the screen says "send what
 * you have now", so one sent is the task done — counting against all eleven would leave it "in progress"
 * for every driver who has no passport. The licence's sides came with Part 1 and do not count here.
 */
function documentsStatus(captures: readonly ApplicationCaptureView[]): TaskStatus {
  const sent = APPLICATION_CAPTURE_REQUESTED.filter(
    (slot) => !PART_ONE_CAPTURE_SLOTS.includes(slot) && captures.some((c) => c.slot === slot),
  ).length;
  return sent === 0 ? "not_started" : "completed";
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
    label: APPLY_SECTION_TITLES[section],
    status: taskStatus(section, draft, v2AsOf, captures),
    optional: OPTIONAL_TASKS.includes(section),
    ...(section === "questions"
      ? { answered: questionnaireProgress(applicantQuestionnaire(draft.questionnaire_version), section, draft.questionnaire) }
      : {}),
  }));
  /**
   * ⚠ Gated on PASSING, not on the Completed status, and on EVERY task: an optional task nobody touched is
   * Not started and passes, because nothing on it is required. The comment here once said no optional
   * screen could fail; §9 P8 is the day a carrier question gained a rule, and the gate needed no change —
   * the questions task simply stopped being optional. Same `validateSection` the Send button's summary is
   * built from.
   */
  const ready = work.every((t) => validateSection(t.section, draft, v2AsOf).length === 0);
  return [...work, { section: SEND_TASK, label: APPLY_COPY.hub.beforeYouSend, status: ready ? "not_started" : "cannot_start", optional: false }];
}
