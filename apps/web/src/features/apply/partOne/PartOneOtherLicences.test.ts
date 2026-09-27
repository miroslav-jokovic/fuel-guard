import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { AppCombobox, AppMemorableDate } from "@silvicom/ui";
import PartOneOtherLicences from "./PartOneOtherLicences.vue";
import { emptyPartOneAnswers, type PartOneAnswers } from "./partOneScreens";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Screen 6's add-a-licence form (Q-AW35 (a)). Pinned: the expiry date is asked as a required answer,
 * with the hint that says a surrendered licence has one too, and "Add this licence" refuses an entry
 * without it — filing refuses such a licence, and after Part 1 nothing can supply the date.
 */
const copy = APPLY_COPY.partOne.otherLicences;

function mountIt() {
  const answers: PartOneAnswers = { ...emptyPartOneAnswers(), otherHeld: true };
  answers.cdl = { state_code: "IL", licence_number: "D1", cdl_class: "A", expires_on: "2029-01-01", endorsements: [] };
  const w = mount(PartOneOtherLicences, {
    props: { errors: {}, answers, "onUpdate:answers": () => {} },
  });
  return { w, answers };
}
const button = (w: ReturnType<typeof mount>, label: string) => w.findAll("button").find((b) => b.text() === label)!;

async function typeEntry(w: ReturnType<typeof mount>, expiry: string | null) {
  await button(w, copy.add).trigger("click");
  w.findComponent(AppCombobox).vm.$emit("update:modelValue", "OH");
  await w.find("#p1-other-number").setValue("OH-555");
  if (expiry) await w.findComponent(AppMemorableDate).vm.$emit("update:modelValue", expiry);
  await button(w, copy.save).trigger("click");
}

describe("adding another licence", () => {
  it("says the date printed on it is wanted even for a licence given up", async () => {
    const { w } = mountIt();
    await button(w, copy.add).trigger("click");
    expect(w.text()).toContain(copy.expiresOn);
    // The owner's words (Q-AW35 (a)), under the date the driver fills in.
    expect(w.find("#p1-other-expires-description").text()).toBe("The date printed on it — even if you gave it up.");
    expect(copy.expiresOn).not.toMatch(/if you know/i);
  });

  it("refuses an entry with no expiry date, in words, and adds nothing", async () => {
    const { w, answers } = mountIt();
    await typeEntry(w, null);
    expect(answers.others).toEqual([]);
    expect(w.text()).toContain(copy.missingExpiry);
  });

  it("adds an entry whose date has passed", async () => {
    const { w, answers } = mountIt();
    await typeEntry(w, "2020-12-31");
    expect(answers.others).toEqual([{ state_code: "OH", agency: "", licence_number: "OH-555", expires_on: "2020-12-31" }]);
    expect(w.text()).not.toContain(copy.missingExpiry);
  });
});
