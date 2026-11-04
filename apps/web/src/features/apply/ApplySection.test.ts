import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { emptyDraft } from "./draft";
import ApplySection from "./ApplySection.vue";
import ApplyEmploymentFields from "./ApplyEmploymentFields.vue";
import AddressHistoryFields from "./AddressHistoryFields.vue";
import { APPLY_COPY } from "./strings";
import QuestionnaireFields from "./QuestionnaireFields.vue";
import { takeServedForm } from "./servedForm";

/** The review screen opens with the §391.21(d) notice (C3c2a); no other screen carries it. */
const at = (section: "review" | "identity") =>
  mount(ApplySection, {
    props: { modelValue: emptyDraft(), section, token: "t", captures: [], asOf: "2026-09-26", identityLockedBy: null },
  }).text();

describe("ApplySection", () => {
  it("puts the notice before sending on the review screen, and only there", () => {
    expect(at("review")).toContain(APPLY_COPY.employerCheck.heading);
    expect(at("identity")).not.toContain(APPLY_COPY.employerCheck.heading);
  });

  it("hands the employment screen (and so its job panel's check) the v2 day, and a legacy link none (C3c2b)", () => {
    const panelDay = (v2AsOf?: string | null) =>
      mount(ApplySection, {
        props: { modelValue: emptyDraft(), section: "employment", token: "t", captures: [], asOf: "2026-09-26", v2AsOf, identityLockedBy: null },
        global: { plugins: [createPinia()] },
      }).findComponent(ApplyEmploymentFields).props("v2AsOf");
    expect(panelDay("2026-09-26")).toBe("2026-09-26");
    expect(panelDay(null)).toBeNull();
    expect(panelDay()).toBeNull();
  });

  it("hands the address screen the v2 day too, so a v2 link gets one address per screen (C3c2c1)", () => {
    const day = (v2AsOf?: string | null) =>
      mount(ApplySection, {
        props: { modelValue: emptyDraft(), section: "addresses", token: "t", captures: [], asOf: "2026-09-26", v2AsOf, identityLockedBy: null },
      }).findComponent(AddressHistoryFields).props("v2AsOf");
    expect(day("2026-09-26")).toBe("2026-09-26");
    expect(day(null)).toBeNull();
  });

  it("asks the carrier's own questions after the built-in ones, and only when some were stamped (§15.3)", () => {
    const sources = () =>
      mount(ApplySection, {
        props: { modelValue: emptyDraft(), section: "questions", token: "t", captures: [], asOf: "2026-09-26", identityLockedBy: null },
      }).findAllComponents(QuestionnaireFields).map((f) => f.props("source"));
    expect(sources()).toEqual(["builtin"]);
    takeServedForm({ carrierQuestions: [{ id: "91000000-0000-4000-8000-000000000001", wording: "Pets?", hint: null, kind: "boolean", choices: null, required: false }] });
    try {
      expect(sources()).toEqual(["builtin", "carrier"]);
    } finally {
      takeServedForm({});
    }
  });
});
