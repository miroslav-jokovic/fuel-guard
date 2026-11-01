import type { DriverApplicationFields } from "./applicationContract.js";
import { isAnswered } from "./questionnaireAnswers.js";
import {
  questionnaireByRef,
  questionnaireForApplicant,
  type QuestionnaireQuestion,
} from "./questionnaireContract.js";

/**
 * The rules that no single field can express, in one list rather than in a `.refine()` chain.
 *
 * A3 needs them twice — once over the whole document at submit, once over the one section a driver
 * is looking at — and two copies of "an empty list is only an answer if you SAID it was empty" is
 * two copies that drift. `check` therefore takes a PARTIAL: mid-form, most of the document does not
 * exist yet, and a rule whose fields are absent must not fire.
 *
 * Every one of them exists for the same reason (H8's lesson, restated in 0208's header): an empty
 * array is an ANSWER, not an omission, and only the driver can turn one into the other.
 */
export interface ApplicationCrossFieldRule {
  /** The field the message attaches to — and the field that decides which section owns the rule. */
  path: keyof DriverApplicationFields;
  /**
   * The rest of the issue's path, under `path` — a carrier question's id under `questionnaire_answers`
   * (§9 P8). Both validators build the issue path as `[path, ...at]`, so the wizard and the API name the
   * same box: `["questionnaire_answers", "position"]`.
   */
  at?: readonly (string | number)[];
  message: string;
  check: (v: Partial<DriverApplicationFields>) => boolean;
}

/**
 * One rule per carrier question the served definition marks `required` (Q-WF3, §9 P8, AF-1).
 *
 * ⚠ Built FROM the definition, never listed: the flag on the question is the only place the set is
 * written, and the screen's mark and the review's missing list read the same flag.
 *
 * ⚠ The check asks the definition the answers were given against (`questionnaire_version`), so an
 * answer set from v2 — which required nothing — is not refused at its certification. No version at
 * all means nothing was answered, and is judged by the served definition: that is the blank send the
 * audit measured.
 *
 * ⚠ **Unlike the rules above, ABSENCE fires it.** Those can let an `undefined` pass because the object
 * schema already refuses a missing `accidents`; the questionnaire's two keys are nullish, so a body that
 * simply leaves them out parses — and a rule that skipped `undefined` let exactly that body through the
 * API's submit route (measured while building P8: twelve rules, no issue). The wizard always hands the
 * rules the whole candidate (`toApplication` writes both keys), and filters them by screen itself.
 */
function requiredQuestionRule(q: QuestionnaireQuestion): ApplicationCrossFieldRule {
  return {
    path: "questionnaire_answers",
    at: [q.id],
    message: `Answer the question "${q.label}"`,
    check: (v) => {
      const def = questionnaireByRef(v.questionnaire_version) ?? questionnaireForApplicant();
      if (!def.questions.some((asked) => asked.id === q.id && asked.required)) return true;
      return isAnswered((v.questionnaire_answers as Record<string, unknown> | null | undefined)?.[q.id]);
    },
  };
}

export const APPLICATION_CROSS_FIELD_RULES: readonly ApplicationCrossFieldRule[] = [
  {
    path: "accidents",
    message: "List every accident in the last 3 years, or confirm there were none",
    check: (v) => v.accidents === undefined || v.accidents.length > 0 || v.declares_no_accidents === true,
  },
  {
    path: "violations",
    message: "List every violation in the last 3 years, or confirm there were none",
    check: (v) => v.violations === undefined || v.violations.length > 0 || v.declares_no_violations === true,
  },
  {
    path: "employers",
    message: "List your employers, or confirm you have not been employed",
    check: (v) => v.employers === undefined || v.employers.length > 0 || v.declares_no_employment === true,
  },
  {
    /**
     * §391.21(b)(6) is mandatory content of the application form, and until now this schema let it be
     * entirely blank — `experience` was nullish and there was nothing else. Either half of the
     * paragraph's sentence satisfies it, and a driver can always answer one: they can name the
     * equipment they have driven even if they will not write a paragraph about it.
     */
    path: "equipment_experience",
    message: "Describe your driving experience, or list the equipment you have driven",
    check: (v) =>
      v.equipment_experience === undefined
      || v.equipment_experience.length > 0
      || Boolean(v.experience?.trim()),
  },
  {
    path: "licence_denial_detail",
    message: "Describe the denial, revocation or suspension",
    check: (v) => v.licence_ever_denied !== true || Boolean(v.licence_denial_detail?.trim()),
  },
  ...questionnaireForApplicant().questions.filter((q) => q.required).map(requiredQuestionRule),
];

/** The issue path a rule reports — the one both validators build (`at`'s comment). */
export const ruleIssuePath = (rule: ApplicationCrossFieldRule): (string | number)[] => [rule.path, ...(rule.at ?? [])];
