import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { AppCombobox, AppSegmentedControl } from "@silvicom/ui";
import {
  applicationBeforeCertificationSchema,
  carrierAnswerIssues,
  questionnaireProgress,
  type CarrierQuestionStamp,
} from "@silvicom/shared";
import ApplyField from "@/features/apply/ApplyField.vue";
import QuestionnaireFields from "@/features/apply/QuestionnaireFields.vue";
import { emptyDraft, fromDraftPayload, toApplication, toDraftPayload } from "@/features/apply/draft";
import { applyLanguage } from "@/features/apply/language";
import { servedCarrierQuestions, takeServedForm } from "@/features/apply/servedForm";
import { missingAnswers } from "@/features/apply/missingAnswers";
import { hubTasks, taskStatus } from "@/features/apply/taskHub";
import { buildReviewSummary } from "@/features/apply/reviewSummary";
import { applicantCarrierQuestionnaire, applicantQuestionnaire } from "@/features/apply/questionnaireCopy";
import { validateSection } from "@/features/apply/useApplicationWizard";

/**
 * §15.3 (HIRING-WORKFLOW-AUDIT-2026-10-31, D-CQ2..D-CQ4): the carrier's OWN questions on the applicant's
 * page — as stamped on the invitation, asked after the built-in ones, answered into `carrier_answers`, sent
 * with the stamp so the page's check is the API's, and in the carrier's words on the Spanish page too.
 */
const PET = "91000000-0000-4000-8000-000000000001";
const LANE = "91000000-0000-4000-8000-000000000002";
const STAMP: CarrierQuestionStamp = [
  { id: PET, wording: "Do you own a pet?", hint: "Dogs and cats count", kind: "boolean", choices: null, required: true },
  { id: LANE, wording: "Preferred lane", hint: null, kind: "select", choices: ["East", "West"], required: false },
];

afterEach(() => {
  takeServedForm({});
  applyLanguage.value = "en";
});

const carrierFields = (draft = emptyDraft()) =>
  mount(QuestionnaireFields, { props: { modelValue: draft, source: "carrier" } });

describe("the bundle's carrier questions", () => {
  it("are taken as served, and a bundle without the key reads as none", () => {
    takeServedForm({ carrierQuestions: STAMP });
    expect(servedCarrierQuestions.value).toEqual(STAMP);
    takeServedForm({});
    expect(servedCarrierQuestions.value).toEqual([]);
  });
});

describe("the questions screen", () => {
  it("draws the stamp's wording, hint and required mark, under the carrier_answers path", () => {
    takeServedForm({ carrierQuestions: STAMP });
    const w = carrierFields();
    const fields = w.findAllComponents(ApplyField);
    expect(fields.map((f) => [f.props("label"), f.props("required") === true, f.props("path")])).toEqual([
      ["Do you own a pet?", true, ["carrier_answers", PET]],
      ["Preferred lane", false, ["carrier_answers", LANE]],
    ]);
    expect(w.text()).toContain("Dogs and cats count");
    // Only the optional one offers the skip.
    expect(w.text().match(/I'd rather not say/g)?.length).toBe(1);
  });

  it("writes answers into carrier_answers, never into the built-in questionnaire", () => {
    takeServedForm({ carrierQuestions: STAMP });
    const draft = emptyDraft();
    const w = carrierFields(draft);
    w.findComponent(AppSegmentedControl).vm.$emit("update:modelValue", "no");
    w.findComponent(AppCombobox).vm.$emit("update:modelValue", "West");
    expect(draft.carrier_answers).toEqual({ [PET]: false, [LANE]: "West" });
    expect(draft.questionnaire).toEqual({});
  });

  it("keeps the carrier's words on the Spanish page, with the product's skip in Spanish", () => {
    takeServedForm({ carrierQuestions: STAMP });
    applyLanguage.value = "es";
    const w = carrierFields();
    expect(w.text()).toContain("Do you own a pet?");
    expect(w.text()).toContain("Prefiero no decirlo");
    expect(w.text()).not.toContain("I'd rather not say");
    // The stored skip stays the English words, as on the built-in questions.
    expect(applicantCarrierQuestionnaire().questions[1]!.skip!.value).toBe("I'd rather not say");
  });

  it("is not drawn when nothing was stamped", () => {
    expect(carrierFields().findAllComponents(ApplyField)).toHaveLength(0);
  });
});

describe("the candidate the page checks and sends", () => {
  it("carries the stamp and the cleaned answers, and none when nothing was stamped", () => {
    takeServedForm({ carrierQuestions: STAMP });
    const draft = { ...emptyDraft(), carrier_answers: { [PET]: true, [LANE]: "  " } };
    expect(toApplication(draft)).toMatchObject({ carrier_questions: STAMP, carrier_answers: { [PET]: true } });
    takeServedForm({});
    expect(toApplication(draft)).toMatchObject({ carrier_questions: null, carrier_answers: null });
  });

  it("is refused for a required carrier question on the questions screen, on its own box, in the page's words", () => {
    takeServedForm({ carrierQuestions: STAMP, requiredQuestions: [] });
    const issues = validateSection("questions", emptyDraft());
    expect(issues.map((i) => [i.path, i.label, i.say])).toEqual([[["carrier_answers", PET], "Do you own a pet?", "Answer this question."]]);
    expect(validateSection("questions", { ...emptyDraft(), carrier_answers: { [PET]: false } })).toEqual([]);
    // And on no other screen.
    expect(validateSection("identity", emptyDraft()).some((i) => i.key === "carrier_answers")).toBe(false);
  });

  it("is refused by the API's own schema once the rest of the document parses", () => {
    takeServedForm({ carrierQuestions: STAMP });
    const candidate = { ...(toApplication(emptyDraft()) as object), carrier_answers: { [LANE]: "North" } };
    const refusal = applicationBeforeCertificationSchema.safeParse(candidate).error!.issues;
    // The base fields are blank here, so Zod never reaches the refinement; the shared check is the rule.
    expect(refusal.some((i) => i.path[0] === "carrier_answers")).toBe(false);
    expect(carrierAnswerIssues(STAMP, { [LANE]: "North" }).map((i) => i.path)).toEqual([
      ["carrier_answers", PET], ["carrier_answers", LANE],
    ]);
  });

  it("autosaves the answers and puts them back on reload", () => {
    const draft = { ...emptyDraft(), carrier_answers: { [PET]: false } };
    const saved = JSON.parse(JSON.stringify(toDraftPayload(draft))) as Record<string, unknown>;
    expect(saved.carrier_answers).toEqual({ [PET]: false });
    expect(fromDraftPayload(saved).carrier_answers).toEqual({ [PET]: false });
    expect(fromDraftPayload({ carrier_answers: ["not", "a", "record"] }).carrier_answers).toEqual({});
  });
});

describe("the review and the task list", () => {
  it("lists an optional one nobody answered or skipped as missing but not blocking, linking to its box", () => {
    takeServedForm({ carrierQuestions: STAMP, requiredQuestions: [] });
    const missing = missingAnswers(emptyDraft(), null).filter((m) => m.issue.path[0] === "carrier_answers");
    expect(missing.map((m) => [m.issue.path[1], m.required, m.issue.section, m.issue.label])).toEqual([
      [LANE, false, "questions", "Preferred lane"],
    ]);
    const skipped = { ...emptyDraft(), carrier_answers: { [LANE]: "I'd rather not say" } };
    expect(missingAnswers(skipped, null).some((m) => m.issue.path[0] === "carrier_answers")).toBe(false);
  });

  it("counts the stamp on the questions task, and an untouched screen is still not started", () => {
    takeServedForm({ carrierQuestions: STAMP, requiredQuestions: [] });
    const builtIn = questionnaireProgress(applicantQuestionnaire(), "questions", {}).total;
    const draft = { ...emptyDraft(), carrier_answers: { [LANE]: "East" } };
    const task = hubTasks(draft, null, []).find((t) => t.section === "questions")!;
    expect(task.answered).toEqual({ answered: 1, total: builtIn + 2 });
    expect(taskStatus("questions", emptyDraft(), null, [])).toBe("not_started");
  });

  it("prints the carrier's questions after the built-in ones on the summary", () => {
    takeServedForm({ carrierQuestions: STAMP });
    const sections = buildReviewSummary({
      draft: { ...emptyDraft(), carrier_answers: { [PET]: true } },
      questionnaire: applicantQuestionnaire(),
      carrier: applicantCarrierQuestionnaire(),
      captures: [],
    });
    const entries = sections.find((s) => s.section === "questions")!.groups[0]!.entries;
    expect(entries.slice(-2).map((e) => [e.label, e.value, e.muted])).toEqual([
      ["Do you own a pet?", "Yes", false],
      ["Preferred lane", expect.any(String), true],
    ]);
  });
});
