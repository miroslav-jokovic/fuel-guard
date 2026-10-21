import { questionnaireForApplicant, translateQuestionnaire, type QuestionnaireDefinition } from "@silvicom/shared";
import { applyLanguage } from "./language";

/**
 * The carrier's questions as the applicant's screens show them: the served definition, in the page's
 * language (C4, `questionnaireTranslation.ts`). Read at setup — the screen chain is remounted on a
 * language switch (`ApplyPage`), so a setup-time read is current. The office's drawer and the filing
 * keep `questionnaireForApplicant()` itself: what is filed is the carrier's English.
 */
export const applicantQuestionnaire = (): QuestionnaireDefinition =>
  translateQuestionnaire(questionnaireForApplicant(), applyLanguage.value);
