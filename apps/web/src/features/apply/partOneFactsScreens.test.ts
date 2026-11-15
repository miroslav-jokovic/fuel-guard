import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { PartOneFactsView } from "@silvicom/shared";
import LicenceFields from "./LicenceFields.vue";
import CorrectionNote from "./CorrectionNote.vue";
import ApplySection from "./ApplySection.vue";
import { emptyDraft, type ApplicationDraft } from "./draft";
import { APPLY_COPY } from "./strings";

/**
 * Part 1's facts shown read-only in Part 2, and "Something wrong? Tell us" (C3c2c2, Q-AW34, §6.4 items 1
 * and 3), on "Your license" — the one task still drawn whole. "About you" and the home lived in now are
 * walked, and show Part 1's answers there (`wizard/TaskWalk.test.ts`: "ends on Part 1's answers…",
 * "shows the home Part 1 holds above the one question asked about it…").
 */
const copy = APPLY_COPY.partOneFacts;
const FACTS: PartOneFactsView = {
  intake: {
    phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
    postal_code: "60431", prior_positive_2y: false, cdl_class: "A",
  },
  licences: [{ position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" }],
  asOf: "2026-09-27",
};
const draftWith = (over: Partial<ApplicationDraft> = {}): ApplicationDraft => ({ ...emptyDraft(), date_of_birth: "1980-04-01", ...over });
const button = (w: { findAll: (s: string) => Array<{ text: () => string }> }, label: string) =>
  w.findAll("button").find((b) => b.text().trim() === label) as unknown as { trigger: (e: string) => Promise<void> } | undefined;

describe("Your licences", () => {
  it("is Part 1's licences, shown, with nothing to type", () => {
    const w = mount(LicenceFields, { props: { modelValue: draftWith(), partOne: FACTS } });
    expect(w.text()).toContain("Illinois · IL123 · Class A");
    expect(w.findAll("input").filter((i) => i.attributes("id")?.startsWith("apply-"))).toHaveLength(0);
  });

  it("asks the license when the page holds no Part 1 answers yet", () => {
    const w = mount(LicenceFields, { props: { modelValue: draftWith() } });
    expect(w.find("#apply-cdl_number").exists()).toBe(true);
  });
});

describe("Something wrong? Tell us", () => {
  it("opens a box on request and keeps what is written on the draft", async () => {
    const draft = draftWith();
    const w = mount(CorrectionNote, { props: { modelValue: draft } });
    expect(w.find("textarea").exists()).toBe(false);
    await button(w, copy.tellUs)!.trigger("click");
    await w.find("textarea").setValue("My phone ends in 42.");
    expect(draft.correction_note).toBe("My phone ends in 42.");
  });

  it("opens by itself when a note is already written", () => {
    const w = mount(CorrectionNote, { props: { modelValue: draftWith({ correction_note: "Wrong ZIP." }) } });
    expect((w.find("textarea").element as HTMLTextAreaElement).value).toBe("Wrong ZIP.");
  });

  it("is under the facts on Your license", () => {
    const w = mount(LicenceFields, { props: { modelValue: draftWith(), partOne: FACTS } });
    expect(w.find("[data-part-one-facts]").text()).toContain(copy.tellUs);
  });
});

describe("ApplySection hands the facts to the screen that shows them", () => {
  it("to Your license", () => {
    const w = mount(ApplySection, {
      props: { modelValue: draftWith(), section: "licence", token: "t", captures: [], asOf: "2026-09-27", v2AsOf: "2026-09-27", partOne: FACTS, identityLockedBy: null },
    });
    expect(w.findComponent(LicenceFields).props("partOne")).toEqual(FACTS);
  });
});
