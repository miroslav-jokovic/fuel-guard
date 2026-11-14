import { computed, inject, nextTick, provide, ref, watch, type InjectionKey } from "vue";
import {
  isAsked,
  isGeneratedTask,
  questionsForScreen,
  wizardScreenShown,
  wizardTaskScreens,
  type ApplicationSection,
  type QuestionnaireQuestion,
  type WizardScreen,
} from "@silvicom/shared";
import type { ApplicationDraft } from "@/features/apply/draft";
import { questionnaireAnswers, type QuestionnaireAnswers } from "@/features/apply/questionnaireAnswers";
import { validateSection, type SectionIssue } from "@/features/apply/useApplicationWizard";
import { draftBinding, draftPath, newRow, pathUnder } from "./draftFields";

/**
 * A Part 2 task, one question to a screen (F4 PR 1b-1; SCREEN-MAP §1, §3, §7).
 *
 * ── THE TASK STILL CLOSES; THE SCREEN ONLY ASKS ──────────────────────────────────────────────
 * Part 2 is a task list (D-AW11): the draft autosaves as it is typed, and "Save and continue" closes a
 * task on the task's own check (`validateSection`, the server's schema plus filing's rules). That is
 * left exactly as it was. The walk cuts the task into the screens the catalogue generates
 * (`wizardTaskScreens`): Continue on a screen checks that screen's share of the task's check and moves
 * on, and Continue on the LAST screen is the task's "Save and continue" (`hub.finish`). So what the
 * walk refuses and what the task refuses cannot disagree — it is one check, filtered.
 *
 * ⚠ If the task's check still refuses at the end — a rule that spans two screens — the walk opens the
 * first screen holding a problem, so the driver lands on the box the message is about (Part 1's walk
 * does the same, `usePartOneWizard`). A problem no screen holds is said on the screen in front of them.
 *
 * ── LOOPS ARE DERIVED ─────────────────────────────────────────────────────────────────────────
 * A screen of one list's columns (`WizardScreen.list`) repeats for each row the draft holds, in the
 * catalogue's order, and the list ends with "Any other …?" — Yes adds a row and walks it, No moves on.
 * Rows come from the gate before them (`FactAsk.gate`): Yes opens the first, No clears them. So the
 * number of screens is the driver's own history — SCREEN-MAP §6's "most screens are one tap".
 *
 * ── THE CARRIER'S QUESTIONS ARE THE DEFINITION'S (F4 PR 1b-2) ─────────────────────────────────
 * After a task's catalogue screens come the carrier's questions the served definition puts on that task
 * (`questionsForScreen`) — then the ones the carrier wrote itself, as stamped on the invitation — each
 * asked question on a screen of its own (SCREEN-MAP 2.2–2.4, 2.27…n). A question asked only on another's
 * answer ("If so, when?") appears and goes as that answer changes, as a conditional catalogue screen does.
 *
 * ── PART 1'S ANSWERS, SHOWN AND NOT ASKED ─────────────────────────────────────────────────────
 * "About you" ends on what Part 1 already holds (the date of birth, the phone), read-only with "Something
 * wrong? Tell us" — the section component's card (C3c2c2, Q-AW34), on a screen of its own at the end.
 */

export interface WalkStep {
  /** Stable across re-renders: the screen and the row's own key, so a removal does not move the driver. */
  readonly key: string;
  readonly screen?: WizardScreen;
  /** The row a loop screen asks about. */
  readonly row?: number;
  /** "Any other …?" — the list this ends. */
  readonly another?: string;
  /** One of the carrier's questions, and the answers it is stored in. */
  readonly question?: { readonly q: QuestionnaireQuestion; readonly answers: QuestionnaireAnswers };
  /** The task's Part 1 answers, shown with "Something wrong? Tell us" (`PART_ONE_SHOWN`). */
  readonly partOne?: true;
}

/** The tasks that end on Part 1's answers — `ApplicantDetailsFields`' card, on a v2 link. */
const PART_ONE_SHOWN: readonly ApplicationSection[] = ["identity"];

interface WalkWizard {
  section: { value: ApplicationSection };
  issues: { value: SectionIssue[] };
  setIssues: (issues: SectionIssue[]) => void;
  focusIssue: (issue: SectionIssue) => void;
}

interface WalkHub {
  inTask: { value: boolean };
  finish: () => void;
  leave: () => void;
}

type Rows = Array<Record<string, unknown>>;

export function useTaskWalk(
  draft: ApplicationDraft,
  wizard: WalkWizard,
  hub: WalkHub,
  v2AsOf: () => string | null,
  /** Has the page Part 1's answers to show (a v2 link, once released)? */
  hasPartOne: () => boolean = () => false,
) {
  const binding = draftBinding(() => draft, () => wizard.issues.value);
  /** The carrier's built-in questions, then its own stamped ones — in that order on the task's screens. */
  const questionSources = [questionnaireAnswers(() => draft, "builtin"), questionnaireAnswers(() => draft, "carrier")];
  const doc = (): Record<string, unknown> => draft as unknown as Record<string, unknown>;
  const rowsOf = (list: string): Rows => (doc()[list] as Rows | undefined) ?? [];

  const task = computed<ApplicationSection | null>(() =>
    hub.inTask.value && isGeneratedTask(wizard.section.value) ? wizard.section.value : null);

  /** Every screen of the open task, in walking order, for the answers as they stand. */
  const steps = computed<WalkStep[]>(() => {
    if (!task.value) return [];
    const screens = wizardTaskScreens(task.value);
    const out: WalkStep[] = [];
    for (let i = 0; i < screens.length;) {
      const screen = screens[i]!;
      if (!screen.list) {
        if (wizardScreenShown(screen, (p) => binding.read(p))) out.push({ key: screen.id, screen });
        i += 1;
        continue;
      }
      const run: WizardScreen[] = [];
      while (i < screens.length && screens[i]!.list === screen.list) run.push(screens[i++]!);
      const rows = rowsOf(screen.list);
      rows.forEach((row, r) => {
        for (const s of run) {
          if (wizardScreenShown(s, (p) => binding.read(p, r))) {
            out.push({ key: `${s.id}#${String(row.key ?? r)}`, screen: s, row: r });
          }
        }
      });
      if (rows.length > 0) out.push({ key: `${screen.list}.another`, another: screen.list });
    }
    for (const answers of questionSources) {
      for (const q of questionsForScreen(answers.definition(), task.value)) {
        if (isAsked(q, answers.answers())) out.push({ key: `${answers.pathKey}.${q.id}`, question: { q, answers } });
      }
    }
    if (PART_ONE_SHOWN.includes(task.value) && hasPartOne()) out.push({ key: `${task.value}.part_one`, partOne: true });
    return out;
  });

  const at = ref(0);
  const atKey = ref<string | null>(null);
  /** The step on show: by its key, or — when its row was just removed — the one now in its place. */
  const index = computed(() => {
    const byKey = atKey.value === null ? -1 : steps.value.findIndex((s) => s.key === atKey.value);
    return byKey >= 0 ? byKey : Math.min(at.value, Math.max(steps.value.length - 1, 0));
  });
  const current = computed<WalkStep | null>(() => steps.value[index.value] ?? null);

  /** "Any other …?", answered on its screen and never stored: a Yes is the row it adds. */
  const another = ref<boolean | null>(null);
  const anotherRefused = ref(false);

  function moveTo(i: number): void {
    at.value = i;
    atKey.value = steps.value[i]?.key ?? null;
    another.value = null;
    anotherRefused.value = false;
    globalThis.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  // Opening a task starts at its first screen.
  watch(task, () => moveTo(0));

  /** A gate's own refusal is reported at its list (`["accidents"]`), not under it. */
  const atGate = (issue: SectionIssue, gate: string | undefined): boolean =>
    gate !== undefined && issue.path.length === 1 && issue.path[0] === gate;
  /**
   * Does a step hold a problem the task's check found? By the problem's PATH: at or under each field's draft
   * path (one other name's problem is the list's screen's), at a gate's list, or under a question's answer
   * (a reference's phone is the references screen's).
   */
  const owns = (step: WalkStep, issue: SectionIssue): boolean => {
    if (step.question) return pathUnder(issue.path, step.question.answers.pathOf(step.question.q));
    return (step.screen?.fields ?? []).some((f) =>
      pathUnder(issue.path, draftPath(f.fact.path, step.row)) || atGate(issue, f.ask.gate));
  };

  /** A problem the task's check found that no screen of the task shows — said, never dropped. */
  const stray = computed<string[]>(() =>
    wizard.issues.value.filter((i) => !steps.value.some((s) => owns(s, i))).map((i) => i.say));

  function finish(): void {
    hub.finish();
    if (!hub.inTask.value) return;
    // Refused: open the first screen holding a problem the check named.
    const first = steps.value.findIndex((s) => wizard.issues.value.some((i) => owns(s, i)));
    if (first >= 0) {
      const kept = wizard.issues.value;
      moveTo(first);
      void nextTick(() => kept[0] && wizard.focusIssue(kept[0]));
    }
  }

  function next(): void {
    const step = current.value;
    if (!task.value || !step) {
      hub.finish();
      return;
    }
    if (step.another) {
      if (another.value === null) {
        anotherRefused.value = true;
        return;
      }
      if (another.value) {
        const list = step.another;
        doc()[list] = [...rowsOf(list), newRow(list)];
        // The new row's first screen sits where "Any other?" was, right after the row before it.
        const firstOfNew = steps.value.findIndex((s) => s.screen?.list === list && s.row === rowsOf(list).length - 1);
        if (firstOfNew >= 0) moveTo(firstOfNew);
        return;
      }
      if (index.value < steps.value.length - 1) moveTo(index.value + 1);
      else finish();
      return;
    }
    // ⚠ A gate answered Yes is not refused for its list being empty: the rows are the NEXT screens' to ask,
    // and a blank first row is dropped from what files, so the list rule would hold the driver on "Yes".
    // If the rows are still empty at the close, the task's check says so and opens the gate again.
    const openedList = step.screen?.gate && binding.read(step.screen.fields[0]!.fact.path) === true ? step.screen.gate : undefined;
    const found = validateSection(task.value, draft, v2AsOf()).filter((i) => owns(step, i) && !atGate(i, openedList));
    wizard.setIssues(found);
    if (found.length > 0) {
      wizard.focusIssue(found[0]!);
      return;
    }
    if (index.value < steps.value.length - 1) moveTo(index.value + 1);
    else finish();
  }

  function back(): void {
    wizard.setIssues([]);
    if (task.value && index.value > 0) moveTo(index.value - 1);
    else hub.leave();
  }

  /** Take the row on show out of its list. The screen in its place is the next row's, or "Any other?". */
  function removeRow(): void {
    const step = current.value;
    const list = step?.screen?.list;
    if (!step || list === undefined || step.row === undefined) return;
    const first = steps.value.findIndex((s) => s.screen?.list === list && s.row === step.row);
    doc()[list] = rowsOf(list).filter((_, r) => r !== step.row);
    wizard.setIssues([]);
    // The driver lands where the removed row began — on the next row, or on the question after the list.
    atKey.value = null;
    at.value = Math.max(first, 0);
    if (rowsOf(list).length === 0) {
      // No rows left: back to the gate, which now reads unanswered.
      const gate = steps.value.findIndex((s) => s.screen?.gate === list);
      if (gate >= 0) moveTo(gate);
    }
  }

  /** "Any other …?" answered — through the walk, so the screen that draws it never writes its prop. */
  function answerAnother(value: boolean | null): void {
    another.value = value;
    anotherRefused.value = false;
  }

  /** Open the screen an issue is about — the send summary's entries land on their box (D-AX3). */
  function show(issue: SectionIssue): void {
    const i = steps.value.findIndex((s) => owns(s, issue));
    if (i >= 0) moveTo(i);
  }

  return {
    binding,
    /** Is a generated task open? Otherwise the hub and the section component carry on as before. */
    active: computed(() => task.value !== null),
    steps,
    current,
    step: computed(() => index.value + 1),
    count: computed(() => steps.value.length),
    atStart: computed(() => index.value === 0),
    atEnd: computed(() => index.value >= steps.value.length - 1),
    stray,
    another,
    anotherRefused,
    answerAnother,
    next,
    back,
    removeRow,
    show,
  };
}

export type TaskWalk = ReturnType<typeof useTaskWalk>;

const TASK_WALK: InjectionKey<TaskWalk> = Symbol("task-walk");

/** Provided once by the page (`ApplyPage`), read by the section that renders it (`ApplySection`). */
export function provideTaskWalk(walk: TaskWalk): TaskWalk {
  provide(TASK_WALK, walk);
  return walk;
}

export const useTaskWalkContext = (): TaskWalk | null => inject(TASK_WALK, null);
