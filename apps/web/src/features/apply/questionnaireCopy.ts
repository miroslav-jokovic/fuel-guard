import {
  questionnaireByRef,
  questionnaireForApplicant,
  translateQuestionnaire,
  type QuestionnaireDefinition,
} from "@silvicom/shared";
import { applyLanguage } from "./language";

/**
 * The carrier's questions as the applicant's screens show them: the definition the draft's answers are
 * being given against (§9 P8 — v2 for a draft started before v3, the served one otherwise), in the page's
 * language (C4, `questionnaireTranslation.ts`). Read at setup — the screen chain is remounted on a
 * language switch (`ApplyPage`), so a setup-time read is current. The office's drawer and the filing
 * keep the English definition: what is filed is the carrier's English.
 */
export const applicantQuestionnaire = (version?: string | null): QuestionnaireDefinition =>
  translateQuestionnaire(questionnaireByRef(version) ?? questionnaireForApplicant(), applyLanguage.value);
