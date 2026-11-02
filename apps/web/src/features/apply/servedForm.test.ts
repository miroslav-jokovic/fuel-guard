import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { APPLICATION_CAPTURE_REQUESTED, APPLICATION_CROSS_FIELD_RULES } from "@silvicom/shared";
import ApplyField from "@/features/apply/ApplyField.vue";
import QuestionnaireFields from "@/features/apply/QuestionnaireFields.vue";
import { emptyDraft, toApplication } from "@/features/apply/draft";
import { applicantQuestionnaire } from "@/features/apply/questionnaireCopy";
import { applyLanguage } from "@/features/apply/language";
import { servedDocumentSlots, servedRequiredQuestions, takeServedForm } from "@/features/apply/servedForm";

/**
 * §11 (HIRING-WORKFLOW-AUDIT): what the carrier asks of THIS applicant, as the bundle served it — laid
 * over the questionnaire every screen reads, and onto the candidate the page checks and sends.
 */
afterEach(() => {
  takeServedForm({});
  applyLanguage.value = "en";
});

const requiredOn = (section: "identity" | "questions") => {
  const w = mount(QuestionnaireFields, { props: { modelValue: emptyDraft(), section } });
  return Object.fromEntries(w.findAllComponents(ApplyField).map((f) => [String(f.props("label")), f.props("required") === true]));
};

describe("the bundle's stamp", () => {
  it("is taken as served, and a bundle without the keys reads as nothing stamped and every document", () => {
    takeServedForm({ requiredQuestions: ["references"], offeredDocumentSlots: ["cdl_front"] });
    expect(servedRequiredQuestions.value).toEqual(["references"]);
    expect(servedDocumentSlots.value).toEqual(["cdl_front"]);
    takeServedForm({});
    expect(servedRequiredQuestions.value).toBeNull();
    expect(servedDocumentSlots.value).toEqual(APPLICATION_CAPTURE_REQUESTED);
  });

  it("decides which questions the screen marks required", () => {
    takeServedForm({ requiredQuestions: ["heard_from"] });
    const marks = requiredOn("identity");
    expect(marks["How did you hear about this company?"]).toBe(true);
    expect(marks["Position you are applying for"]).toBe(false);
  });

  it("leaves the definition's own seven marked with no stamp", () => {
    expect(requiredOn("identity")["Position you are applying for"]).toBe(true);
  });

  it("takes the skip away from a question it requires, and leaves it on the others (D-RS5)", () => {
    takeServedForm({ requiredQuestions: ["references"] });
    const w = mount(QuestionnaireFields, { props: { modelValue: emptyDraft(), section: "questions" } });
    // "I'd rather not say" stays on military service; references, now required, has none.
    expect(w.text().match(/I'd rather not say/g)?.length).toBe(1);
    const def = applicantQuestionnaire();
    expect(def.questions.find((q) => q.id === "references")).toMatchObject({ required: true });
    expect(def.questions.find((q) => q.id === "references")!.skip).toBeUndefined();
  });

  it("survives the Spanish translation", () => {
    takeServedForm({ requiredQuestions: ["references"] });
    applyLanguage.value = "es";
    const def = applicantQuestionnaire();
    expect(def.questions.filter((q) => q.required).map((q) => q.id)).toEqual(["references"]);
    expect(def.questions.find((q) => q.id === "references")!.skip).toBeUndefined();
  });

  it("rides on the candidate the page checks and sends, so its rules are the API's", () => {
    takeServedForm({ requiredQuestions: ["heard_from"] });
    expect((toApplication(emptyDraft()) as Record<string, unknown>).questionnaire_required).toEqual(["heard_from"]);
    takeServedForm({});
    expect((toApplication(emptyDraft()) as Record<string, unknown>).questionnaire_required).toBeNull();
  });

  it("decides what the wizard's per-screen check refuses — the rules run over the candidate", () => {
    // What `useApplicationWizard` does on each screen: every cross-field rule, over `toApplication`.
    const refused = () => {
      const candidate = toApplication(emptyDraft()) as Record<string, unknown>;
      return APPLICATION_CROSS_FIELD_RULES.filter((r) => r.path === "questionnaire_answers" && !r.check(candidate)).map((r) => r.at?.[0]);
    };
    takeServedForm({ requiredQuestions: ["heard_from"] });
    expect(refused()).toEqual(["heard_from"]);
    takeServedForm({ requiredQuestions: [] });
    expect(refused()).toEqual([]);
    takeServedForm({});
    expect(refused()).toHaveLength(7);
  });
});
