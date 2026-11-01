import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { CARRIER_ANSWERS } from "@/testing/carrierAnswers";
import ReviewFields from "./ReviewFields.vue";
import { emptyDraft, type ApplicationDraft } from "./draft";
import { documentIssues, missingAnswers } from "./missingAnswers";
import { APPLY_COPY } from "./strings";

/**
 * §9 P8 (AF-5): the review counts what is missing and links each one to its box — before Send, from
 * the Send button's own check, so the list and the refusal cannot disagree.
 */
const complete = (): ApplicationDraft => ({
  ...emptyDraft(),
  questionnaire: { ...CARRIER_ANSWERS, military_service: false, other_training: "Doesn't apply", references: "I'd rather not say" },
  experience: "Eight years, dry van and reefer.",
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
  declares_no_employment: true, employers: [],
  declares_no_accidents: true, declares_no_violations: true, licence_ever_denied: false,
});

const copy = APPLY_COPY.missing;

describe("what is missing, before Send", () => {
  it("is nothing for a complete application with every optional question answered or skipped", () => {
    expect(missingAnswers(complete(), null)).toEqual([]);
  });

  it("lists exactly what Send would refuse, as required, then the optional ones left blank", () => {
    const d = complete();
    d.questionnaire = { ...d.questionnaire, position: "", proof_of_age: null };
    delete d.questionnaire.references;
    const missing = missingAnswers(d, null);
    expect(missing.filter((m) => m.required).map((m) => m.issue)).toEqual(documentIssues(d, null));
    expect(missing.map((m) => [m.issue.path.join("."), m.required])).toEqual([
      ["questionnaire_answers.position", true],
      ["questionnaire_answers.proof_of_age", true],
      ["questionnaire_answers.references", false],
    ]);
    // The optional one names its skip, so the applicant knows they can pass it on purpose.
    expect(missing[2]!.issue.say).toBe(APPLY_COPY.carrierQuestions.answerOrSkip("I'd rather not say"));
  });

  it("does not list a question that is not asked: \"When?\" after a no", () => {
    const paths = missingAnswers(complete(), null).map((m) => m.issue.path.join("."));
    expect(paths).not.toContain("questionnaire_answers.military_when");
  });
});

describe("the review screen", () => {
  it("counts what is missing and links each one to its box", async () => {
    const d = complete();
    d.questionnaire = { ...d.questionnaire, heard_from: "" };
    delete d.questionnaire.other_training;
    const w = mount(ReviewFields, { props: { draft: d, captures: [] } });
    expect(w.text()).toContain(copy.heading(2));
    expect(w.text()).toContain(copy.mustAnswer);
    const link = w.findAll("button").find((b) => b.text() === "How did you hear about this company?")!;
    await link.trigger("click");
    const shown = w.emitted("show")![0]![0] as { fieldId: string; section: string };
    expect(shown).toMatchObject({ fieldId: "apply-questionnaire_answers-heard_from", section: "identity" });
  });

  it("says Send is still possible when only optional answers are missing", () => {
    const d = complete();
    delete d.questionnaire.references;
    const w = mount(ReviewFields, { props: { draft: d, captures: [] } });
    expect(w.text()).toContain(copy.heading(1));
    expect(w.text()).toContain(copy.canStillSend);
  });

  it("shows no list when nothing is missing", () => {
    const w = mount(ReviewFields, { props: { draft: complete(), captures: [] } });
    expect(w.text()).not.toContain(copy.heading(0));
    expect(w.text()).not.toContain(copy.canStillSend);
  });
});
