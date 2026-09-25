import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { AppCombobox } from "@silvicom/ui";
import QuestionnaireFields from "@/features/apply/QuestionnaireFields.vue";
import { emptyDraft, type ApplicationDraft } from "@/features/apply/draft";

/**
 * Q-HM14's question on the wizard: the applicant reads words and the draft stores a KEY.
 *
 * ⚠ The key is what the ceremony, the packet and the checklist match on (`applyingAsOf`), so a select
 * that stored the label — as every other carrier `select` does — would be read by all of them as no
 * answer at all, and a company driver would be walked to page 31's owner-operator line.
 */

const mountIt = (draft: ApplicationDraft = emptyDraft()) =>
  mount(QuestionnaireFields, { props: { modelValue: draft, section: "identity" } });

const applyingAs = (w: ReturnType<typeof mountIt>) =>
  w.findAllComponents(AppCombobox).find((c) =>
    (c.props("options") as Array<{ value: string }>).some((o) => o.value === "owner_operator"),
  )!;

describe("what the applicant is applying as", () => {
  it("is asked on the first screen, beside the position, in words", () => {
    const w = mountIt();
    expect(w.text()).toContain("Are you applying as a company driver or as an owner-operator?");
    expect(applyingAs(w).props("options")).toEqual([
      { value: "company_driver", label: "Company driver" },
      { value: "owner_operator", label: "Owner-operator" },
    ]);
  });

  it("stores the key the choice stands for, not its label", async () => {
    // The component writes into the draft it was given (`draft.value.questionnaire = …`), which is
    // how every other carrier question reaches the autosave.
    const draft = emptyDraft();
    const w = mountIt(draft);
    applyingAs(w).vm.$emit("update:modelValue", "company_driver");
    expect(draft.questionnaire.applying_as).toBe("company_driver");
  });
});
