import { isAsked, type QuestionnaireDefinition, type QuestionnaireQuestion } from "@silvicom/shared";
import type { ApplicationDraft } from "@/features/apply/draft";
import { applicantCarrierQuestionnaire, applicantQuestionnaire } from "@/features/apply/questionnaireCopy";

/**
 * The carrier's questions' answers in the draft — read, written, skipped — for whichever screen asks them:
 * the section component that lays a task's questions out together (`QuestionnaireFields`, until F4 PR 1b-5
 * retires it), and the walk that asks them one to a screen (`useTaskWalk`, F4 PR 1b-2). One set of rules,
 * so a question answered either way is stored the same way.
 *
 * `builtin` is the carrier's definition the draft's answers are given against (§9 P8); `carrier` is the
 * questions the carrier wrote itself, as stamped on this invitation (§15.3 D-CQ4), answered into
 * `carrier_answers` and refused under that path.
 */
export type QuestionSource = "builtin" | "carrier";

export function questionnaireAnswers(draft: () => ApplicationDraft, source: QuestionSource) {
  const carrier = source === "carrier";
  /** Where the answers live in the draft, and the contract key a refusal names. */
  const answersKey = carrier ? "carrier_answers" : "questionnaire";
  const pathKey = carrier ? "carrier_answers" : "questionnaire_answers";

  const definition = (): QuestionnaireDefinition =>
    carrier ? applicantCarrierQuestionnaire() : applicantQuestionnaire(draft().questionnaire_version);

  const answers = (): Record<string, unknown> => draft()[answersKey];
  const answer = (id: string): unknown => answers()[id];

  /**
   * Set one answer — and clear any question asked only on the answer this one had (AF-6): a "When?"
   * typed after a "yes" that is then changed to "no" is an answer to a question no longer asked.
   */
  function set(id: string, value: unknown): void {
    const next: Record<string, unknown> = { ...answers(), [id]: value };
    for (const q of definition().questions) {
      if (q.askedWhen?.question === id && !isAsked(q, next)) delete next[q.id];
    }
    draft()[answersKey] = next;
  }

  /** An optional question the applicant has chosen not to answer — its box is put away (§9 P8). */
  const skipped = (q: QuestionnaireQuestion): boolean => Boolean(q.skip) && answer(q.id) === q.skip!.value;
  const setSkipped = (q: QuestionnaireQuestion, on: boolean): void => set(q.id, on ? q.skip!.value : null);

  return {
    source,
    pathKey,
    definition,
    answers,
    answer,
    set,
    skipped,
    setSkipped,
    /** The contract path of one answer — what a refusal names and what `ApplyField` derives its id from. */
    pathOf: (q: QuestionnaireQuestion): [string, string] => [pathKey, q.id],
  };
}

export type QuestionnaireAnswers = ReturnType<typeof questionnaireAnswers>;
