import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { questionnaireForApplicant } from "@silvicom/shared";
import QuestionnaireFields from "./QuestionnaireFields.vue";
import ApplyEmploymentFields from "./ApplyEmploymentFields.vue";
import { emptyDraft, emptyEquipment, type ApplicationDraft } from "./draft";

/**
 * The applicant's form is built from the SAME controls as the rest of the product.
 *
 * ── WHY THIS IS A TEST AND NOT A CONVENTION ───────────────────────────────────────────────────
 * `apps/web/CLAUDE.md` says it in as many words — *"FilterSelect (toolbars) vs ComboSelect
 * (forms)"* — and the apply flow was the one surface answering a choice with the browser's own
 * `<select>`. It is the kind of drift nothing catches: every gate passed, every screen worked, and
 * the page simply read as a different application bolted onto this one. A different chevron, a
 * different focus ring, and on a phone a native sheet thrown over the form.
 *
 * Reported by the owner, 2026-09-11: *"dropdowns in inputs are not properly set as we doing it in
 * our dashboard"*. So the rule gets an assertion rather than another paragraph.
 */

const questionnaire = questionnaireForApplicant();

describe("the carrier's own questions", () => {
  const screen = (section: "identity" | "employment" | "questions") =>
    mount(QuestionnaireFields, {
      props: { modelValue: emptyDraft(), section },
    });

  it("answers a yes/no question with two buttons, not a dropdown (§9 P8, AF-6)", () => {
    // `legally_work` and `proof_of_age` are both booleans and both sit on the identity screen.
    const w = screen("identity");
    expect(w.findAll("select")).toHaveLength(0);
    const groups = w.findAll('[role="radiogroup"]');
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g.findAll('[role="radio"]').map((r) => r.text())).toEqual(["Yes", "No"]);
  });

  it("keeps the three-state answer a yes/no question needs", () => {
    // Two buttons and neither pressed — yes, no, and not answered. Blank is a different fact from
    // "no" to the recruiter reading the rendered application.
    const w = screen("identity");
    const pressed = w.findAll('[role="radio"]').filter((r) => r.attributes("aria-checked") === "true");
    expect(pressed).toHaveLength(0);
  });

  it("marks every required question and no other (§9 P8, AF-6)", () => {
    for (const section of ["identity", "employment", "questions"] as const) {
      const w = screen(section);
      const required = questionnaire.questions.filter((q) => (q.screen ?? "questions") === section && q.required);
      expect(w.findAll('label span[aria-hidden="true"]').length).toBe(required.length);
    }
  });

  it("asks \"If so, when?\" only after a yes, and forgets it on a no (AF-6)", async () => {
    // The component writes into the draft it is given (`draft.value.questionnaire = …`), so the draft is
    // reactive here and read back directly.
    const draft = reactive(emptyDraft());
    const w = mount(QuestionnaireFields, { props: { modelValue: draft, section: "questions" } });
    const military = () => w.findAll('[role="radiogroup"]').find((g) => g.attributes("aria-label")?.includes("military"))!;
    expect(w.text()).not.toContain("If so, when?");
    await military().findAll('[role="radio"]')[0]!.trigger("click");
    expect(draft.questionnaire.military_service).toBe(true);
    expect(w.text()).toContain("If so, when?");
    draft.questionnaire = { ...draft.questionnaire, military_when: "1999–2003" };
    await military().findAll('[role="radio"]')[1]!.trigger("click");
    expect(draft.questionnaire.military_service).toBe(false);
    expect("military_when" in draft.questionnaire).toBe(false);
    expect(w.text()).not.toContain("If so, when?");
  });

  it("stores an optional question's skip as its own answer, distinct from blank and from no (§9 P8)", async () => {
    const draft = reactive(emptyDraft());
    const w = mount(QuestionnaireFields, { props: { modelValue: draft, section: "questions" } });
    const skip = w.findAll('input[type="checkbox"]').find((c) => c.element.closest("label")?.textContent?.includes("Doesn't apply"))!;
    await skip.setValue(true);
    expect(draft.questionnaire.other_training).toBe("Doesn't apply");
    // The box is put away: an answer and a skip cannot both be on file.
    expect(w.findAll("textarea")).toHaveLength(0);
    await skip.setValue(false);
    expect(draft.questionnaire.other_training).toBeNull();
  });

  it("renders no native dropdown on any of its screens", () => {
    for (const section of ["identity", "employment", "questions"] as const) {
      expect(screen(section).findAll("select")).toHaveLength(0);
    }
  });

  it("still asks every question the definition puts on the screen", () => {
    // The guard against a swap that quietly dropped a question: the count is the definition's.
    // `askedWhen` questions excepted: "If so, when?" is asked only after a yes (AF-6), pinned above.
    const onQuestions = questionnaire.questions.filter((q) => (q.screen ?? "questions") === "questions" && !q.askedWhen);
    const text = screen("questions").text();
    for (const q of onQuestions) expect(text).toContain(q.label);
  });
});

describe("the equipment grid", () => {
  const withRow = (): ApplicationDraft => {
    const d = emptyDraft();
    d.equipment_experience = [{ ...emptyEquipment(), equipment_class: "tractor_semi_trailer" }];
    return d;
  };

  const SlideOverStub = {
    template: "<div v-if='open'><slot /><slot name='footer' /></div>",
    props: ["open", "title", "size", "description"],
  };

  it("chooses a class of equipment with the forms control", () => {
    const w = mount(ApplyEmploymentFields, {
      props: { modelValue: withRow(), asOf: "2026-09-26" },
      global: { stubs: { SlideOver: SlideOverStub } },
    });
    expect(w.findAll("select")).toHaveLength(0);
    // And it shows the choice back as its label, not as the stored token.
    expect(w.text()).not.toContain("tractor_semi_trailer");
  });
});
