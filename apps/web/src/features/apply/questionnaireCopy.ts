import {
  carrierQuestionnaire,
  questionnaireByRef,
  questionnaireForApplicant,
  translateQuestionnaire,
  withRequiredQuestions,
  withSkipWordsIn,
  type QuestionnaireDefinition,
} from "@silvicom/shared";
import { applyLanguage } from "./language";
import { servedCarrierQuestions, servedRequiredQuestions } from "./servedForm";

/**
 * The carrier's questions as the applicant's screens show them: the definition the draft's answers are
 * being given against (§9 P8 — v2 for a draft started before v3, the served one otherwise), in the page's
 * language (C4, `questionnaireTranslation.ts`). Read at setup — the screen chain is remounted on a
 * language switch (`ApplyPage`), so a setup-time read is current. The office's drawer and the filing
 * keep the English definition: what is filed is the carrier's English.
 */
export const applicantQuestionnaire = (version?: string | null): QuestionnaireDefinition =>
  translateQuestionnaire(
    // §11 D-RS4: the carrier's set as stamped on this invitation — the same overlay the rule applies.
    withRequiredQuestions(questionnaireByRef(version) ?? questionnaireForApplicant(), servedRequiredQuestions.value),
    applyLanguage.value,
  );

/**
 * The carrier's OWN questions (§15.3), as stamped on this invitation: in the carrier's words on every page
 * (D-CQ4, Q-MT1), with only the product's skip in the page's language. Empty when none were stamped.
 */
export const applicantCarrierQuestionnaire = (): QuestionnaireDefinition =>
  withSkipWordsIn(carrierQuestionnaire(servedCarrierQuestions.value), applyLanguage.value);
