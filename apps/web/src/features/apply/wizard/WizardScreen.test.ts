import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { AppCheckbox, AppCombobox, AppRadioGroup, AppTypedDate } from "@silvicom/ui";
import { WIZARD_SCREENS, type WizardScreenId } from "@silvicom/shared";
import WizardScreen from "./WizardScreen.vue";
import { PART_ONE_BOUND_PATHS, partOneBinding } from "./partOneFields";
import { emptyPartOneAnswers, type PartOneAnswers } from "@/features/apply/partOne/partOneScreens";
import { APPLY_COPY } from "@/features/apply/strings";
import { setApplyLanguage } from "@/features/apply/language";

/**
 * The one generated screen (F4 PR 1, SCREEN-MAP §7): it renders whatever the catalogue put on a screen,
 * with the control the fact's kind calls for, and writes the answer back through the page's binding.
 */
const screen = (id: WizardScreenId) => WIZARD_SCREENS.find((s) => s.id === id)!;

function mountScreen(id: WizardScreenId, errors: Record<string, string> = {}) {
  const answers: PartOneAnswers = emptyPartOneAnswers();
  const w = mount(WizardScreen, { props: { screen: screen(id), binding: partOneBinding(() => answers, () => errors) } });
  return { w, answers };
}

afterEach(() => setApplyLanguage("en"));

describe("a generated screen", () => {
  it("has words for every field the catalogue puts on Part 1's screens, and none for a field it does not", () => {
    const asked = WIZARD_SCREENS.flatMap((s) => s.fields.map((f) => f.fact.path)).sort();
    expect([...PART_ONE_BOUND_PATHS()].sort()).toEqual(asked);
  });

  it("asks a yes/no as a Yes and a No, and records the answer", async () => {
    const { w, answers } = mountScreen("screening.prior_positive");
    expect(w.text()).toContain(APPLY_COPY.partOne.screening.priorPositive);
    const yesNo = w.findComponent(AppRadioGroup);
    expect((yesNo.props("options") as Array<{ label: string }>).map((o) => o.label)).toEqual([APPLY_COPY.partOne.yes, APPLY_COPY.partOne.no]);
    yesNo.vm.$emit("update:modelValue", "yes");
    expect(answers.prior_positive_2y).toBe(true);
  });

  it("offers the contract's classes, and writes the CDL's class where the page keeps it", async () => {
    const { w, answers } = mountScreen("licence.class");
    const group = w.findComponent(AppRadioGroup);
    expect((group.props("options") as Array<{ value: string }>).map((o) => o.value)).toEqual(["A", "B", "C"]);
    group.vm.$emit("update:modelValue", "B");
    expect(answers.cdl.cdl_class).toBe("B");
  });

  it("keeps endorsements in the contract's order, whatever order they are ticked in", async () => {
    const { w, answers } = mountScreen("licence.endorsements");
    const boxes = w.findAllComponents(AppCheckbox);
    expect(boxes.map((b) => b.props("label"))).toContain(APPLY_COPY.partOne.licence.endorsementLabels.H);
    boxes.at(3)!.vm.$emit("update:modelValue", true); // T
    boxes.at(0)!.vm.$emit("update:modelValue", true); // H
    expect(answers.cdl.endorsements).toEqual(["H", "T"]);
    boxes.at(0)!.vm.$emit("update:modelValue", false);
    expect(answers.cdl.endorsements).toEqual(["T"]);
  });

  it("puts the address's fields on one screen, with the state list and a five-digit ZIP box", async () => {
    const { w, answers } = mountScreen("address.home");
    expect(w.findComponent(AppCombobox).exists()).toBe(true);
    const zip = w.find("#p1-postal_code");
    expect(zip.attributes("inputmode")).toBe("numeric");
    expect(zip.attributes("maxlength")).toBe("5");
    await w.find("#p1-address_line1").setValue("1 Main St");
    expect(answers.address_line1).toBe("1 Main St");
  });

  it("asks a date in the years its screen says — a CDL's expiration is in the future", () => {
    const { w } = mountScreen("licence.expires");
    expect(w.findComponent(AppTypedDate).props("kind")).toBe("future");
    expect(mountScreen("about.date_of_birth").w.findComponent(AppTypedDate).props("kind")).toBe("dob");
  });

  it("shows the problem the page's check found under the field it is about", () => {
    const { w } = mountScreen("about.phone", { phone: "Enter your mobile phone number." });
    expect(w.find("#p1-phone").attributes("type")).toBe("tel");
    expect(w.text()).toContain("Enter your mobile phone number.");
  });

  it("speaks the page's language", () => {
    setApplyLanguage("es");
    const { w } = mountScreen("screening.donor_gender");
    expect(w.text()).toContain(APPLY_COPY.partOne.screening.gender);
    expect(w.text()).not.toContain("Gender, for your drug test");
  });
});
