import {
  applicationBeforeCertificationSchema,
  isAnswered,
  isAsked,
  sectionOwningPath,
} from "@silvicom/shared";
import { toApplication, type ApplicationDraft } from "./draft";
import { describeField, fieldId, type FieldPath } from "./fieldLabels";
import { applicantQuestionnaire } from "./questionnaireCopy";
import { APPLY_COPY } from "./strings";
import { issuesFromParse, v2FilingIssues, type SectionIssue } from "./useApplicationWizard";

/**
 * What stands between the applicant and "Send", and what they have left unanswered (§9 P8, AF-5).
 *
 * ── ONE CHECK, TWO READERS ────────────────────────────────────────────────────────────────────
 * `documentIssues` is the whole-document check the Send button runs (`useApplicationSending`): the
 * server's own schema without the certification, then a v2 filing's own rules. The review screen lists
 * the same issues BEFORE the button is pressed — the audit's finding was a review that said "Not
 * answered" in grey and nothing else, so an applicant learned what was missing only by being refused.
 * A second, review-only definition of "missing" would be the list and the refusal disagreeing.
 *
 * ── AND WHAT IS MISSING BUT DOES NOT BLOCK ────────────────────────────────────────────────────
 * An optional carrier question nobody answered and nobody skipped. Listed, marked optional, with its
 * skip named, because "I'd rather not say" is a real answer the office reads (§4.4) and an applicant
 * who never saw the question cannot give it. Send stays possible.
 */
export interface MissingAnswer {
  issue: SectionIssue;
  required: boolean;
}

/** Everything the Send button would refuse, attributed to the screen that can fix it. */
export function documentIssues(draft: ApplicationDraft, v2AsOf: string | null): SectionIssue[] {
  const candidate = toApplication(draft);
  // ⚠ WITHOUT the certification: on this visit the driver has not signed anything and must not have to.
  const parsed = applicationBeforeCertificationSchema.safeParse(candidate);
  return parsed.success ? v2FilingIssues(draft, v2AsOf) : issuesFromParse(parsed.error.issues, candidate);
}

/** The optional carrier questions still unanswered and not skipped, as issues the list can link to. */
function unansweredOptional(draft: ApplicationDraft): SectionIssue[] {
  const answers = draft.questionnaire;
  return applicantQuestionnaire(draft.questionnaire_version).questions
    .filter((q) => q.skip && !q.required && isAsked(q, answers) && !isAnswered(answers[q.id]))
    .map((q) => {
      const path: FieldPath = ["questionnaire_answers", q.id];
      return {
        path,
        key: "questionnaire_answers",
        message: "optional question unanswered",
        label: describeField(path),
        say: APPLY_COPY.carrierQuestions.answerOrSkip(q.skip!.label),
        fieldId: fieldId(path),
        section: sectionOwningPath(path),
      };
    });
}

/** The review's list: what blocks first, then what is only missing. */
export function missingAnswers(draft: ApplicationDraft, v2AsOf: string | null): MissingAnswer[] {
  return [
    ...documentIssues(draft, v2AsOf).map((issue) => ({ issue, required: true })),
    ...unansweredOptional(draft).map((issue) => ({ issue, required: false })),
  ];
}
