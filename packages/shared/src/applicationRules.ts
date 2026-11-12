import { applicantIssue, type ApplicantIssueKey } from "./applicantIssues.js";
import type { DriverApplicationFields } from "./applicationContract.js";
import { isAnswered } from "./questionnaireAnswers.js";
import { isRequirableQuestion, withRequiredQuestions } from "./applicationFormSettings.js";
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
  /** U7: the key the applicant's page renders in its own language; `message` is its English. */
  issueKey: ApplicantIssueKey;
  params?: Readonly<Record<string, string>>;
  check: (v: Partial<DriverApplicationFields>) => boolean;
}

/**
 * One rule per carrier question that may be required (Q-WF3, §9 P8, AF-1; per carrier since §11).
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
    ...applicantIssue("question_answered", { question: q.label }),
    check: (v) => {
      const asked = questionnaireByRef(v.questionnaire_version) ?? questionnaireForApplicant();
      // §11 D-RS4: the carrier's set as stamped on this applicant's invitation, laid over the definition
      // the answers were given against. Null (an invitation sent before 0550's reader) leaves the
      // definition's own flags in force, exactly as before.
      const def = withRequiredQuestions(asked, v.questionnaire_required);
      if (!def.questions.some((one) => one.id === q.id && one.required)) return true;
      const raw = (v.questionnaire_answers as Record<string, unknown> | null | undefined)?.[q.id];
      // D-RS5: the stored skip of a question the carrier requires is not an answer to it.
      const skip = asked.questions.find((one) => one.id === q.id)?.skip;
      if (skip && raw === skip.value) return false;
      return isAnswered(raw);
    },
  };
}

export const APPLICATION_CROSS_FIELD_RULES: readonly ApplicationCrossFieldRule[] = [
  {
    path: "accidents",
    ...applicantIssue("accidents_listed"),
    check: (v) => v.accidents === undefined || v.accidents.length > 0 || v.declares_no_accidents === true,
  },
  {
    path: "violations",
    ...applicantIssue("violations_listed"),
    check: (v) => v.violations === undefined || v.violations.length > 0 || v.declares_no_violations === true,
  },
  {
    path: "employers",
    ...applicantIssue("employers_listed"),
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
    ...applicantIssue("experience_given"),
    check: (v) =>
      v.equipment_experience === undefined
      || v.equipment_experience.length > 0
      || Boolean(v.experience?.trim()),
  },
  {
    path: "licence_denial_detail",
    ...applicantIssue("denial_described"),
    check: (v) => v.licence_ever_denied !== true || Boolean(v.licence_denial_detail?.trim()),
  },
  {
    // F2c (P4): the carrier's question B has its own "If yes, explain".
    path: "licence_suspension_detail",
    ...applicantIssue("suspension_described"),
    check: (v) => v.licence_suspended !== true || Boolean(v.licence_suspension_detail?.trim()),
  },
  // §11: one rule per question a carrier MAY require (D-RS2), each deciding from the stamp whether it
  // applies — so the set lives on the invitation, and this list never changes with a carrier's setting.
  ...questionnaireForApplicant().questions.filter(isRequirableQuestion).map(requiredQuestionRule),
];

/** The issue path a rule reports — the one both validators build (`at`'s comment). */
export const ruleIssuePath = (rule: ApplicationCrossFieldRule): (string | number)[] => [rule.path, ...(rule.at ?? [])];

/**
 * The carrier-question rules alone, over a whole document (§11 D-RS4) — what `submitApplication` runs
 * again after laying the invitation's own stamp over the one the page sent. The route has already parsed
 * the full contract; only the stamp changed, so only the rules that read it are asked again.
 */
export const questionnaireRequiredIssues = (
  v: Partial<DriverApplicationFields>,
): { path: string; message: string; issueKey: ApplicantIssueKey; params?: Readonly<Record<string, string>> }[] =>
  APPLICATION_CROSS_FIELD_RULES
    .filter((rule) => rule.path === "questionnaire_answers" && !rule.check(v))
    .map((rule) => ({ path: ruleIssuePath(rule).join("."), message: rule.message, issueKey: rule.issueKey, ...(rule.params ? { params: rule.params } : {}) }));
