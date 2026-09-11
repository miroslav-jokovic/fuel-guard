import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
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

/** The control `ComboSelect` renders: a real input with `role="combobox"`, never a `<select>`. */
const comboboxes = (w: { findAll: (s: string) => unknown[] }) => w.findAll('[role="combobox"]');

describe("the carrier's own questions", () => {
  const screen = (section: "identity" | "employment" | "questions") =>
    mount(QuestionnaireFields, {
      props: { modelValue: emptyDraft(), section },
    });

  it("answers a yes/no question with the forms control, not the browser's dropdown", () => {
    // `legally_work` and `proof_of_age` are both booleans and both sit on the identity screen.
    const w = screen("identity");
    expect(w.findAll("select")).toHaveLength(0);
    expect(comboboxes(w).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the three-state answer a yes/no question needs", () => {
    // A checkbox has two states and these questions have three — yes, no, and not answered. Blank
    // is a different fact from "no" to the recruiter reading the rendered application.
    const w = screen("identity");
    const combo = w.findAll('input[role="combobox"]').at(-1);
    expect((combo!.element as HTMLInputElement).value).toBe("");
  });

  it("renders no native dropdown on any of its screens", () => {
    for (const section of ["identity", "employment", "questions"] as const) {
      expect(screen(section).findAll("select")).toHaveLength(0);
    }
  });

  it("still asks every question the definition puts on the screen", () => {
    // The guard against a swap that quietly dropped a question: the count is the definition's.
    const onQuestions = questionnaire.questions.filter((q) => (q.screen ?? "questions") === "questions");
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
      props: { modelValue: withRow() },
      global: { stubs: { SlideOver: SlideOverStub } },
    });
    expect(w.findAll("select")).toHaveLength(0);
    // And it shows the choice back as its label, not as the stored token.
    expect(w.text()).not.toContain("tractor_semi_trailer");
  });
});
