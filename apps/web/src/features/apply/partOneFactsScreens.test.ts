import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { PartOneFactsView } from "@silvicom/shared";
import ApplicantDetailsFields from "./ApplicantDetailsFields.vue";
import LicenceFields from "./LicenceFields.vue";
import CorrectionNote from "./CorrectionNote.vue";
import AddressDrawer from "./AddressDrawer.vue";
import AddressHistoryFields from "./AddressHistoryFields.vue";
import SafetyHistoryFields from "./SafetyHistoryFields.vue";
import ApplySection from "./ApplySection.vue";
import { emptyAddress, emptyDraft, type ApplicationDraft, type DraftAddress } from "./draft";
import { APPLY_COPY } from "./strings";

/**
 * Part 1's facts shown read-only in Part 2 on a v2 link, and "Something wrong? Tell us" (C3c2c2, Q-AW34,
 * §6.4 items 1 and 3). Each screen is checked both ways: with the facts it shows and does not ask; with
 * none (a legacy link) it asks exactly as it did.
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
const SlideOverStub = { template: "<div v-if='open'><slot /><slot name='footer' /></div>", props: ["open", "title", "size", "description"] };
const button = (w: { findAll: (s: string) => Array<{ text: () => string }> }, label: string) =>
  w.findAll("button").find((b) => b.text().trim() === label) as unknown as { trigger: (e: string) => Promise<void> } | undefined;

describe("About you", () => {
  it("shows the date of birth and phone from Part 1, and asks the name and email", () => {
    const w = mount(ApplicantDetailsFields, { props: { modelValue: draftWith(), partOne: FACTS } });
    expect(w.find("[data-part-one-facts]").text()).toContain("04/01/1980");
    expect(w.find("[data-part-one-facts]").text()).toContain("(312) 555-0142");
    expect(w.find("#apply-phone").exists()).toBe(false);
    expect(w.find("#apply-date_of_birth").exists()).toBe(false);
    for (const id of ["first_name", "last_name", "email"]) expect(w.find(`#apply-${id}`).exists(), id).toBe(true);
    // It no longer tells the driver to enter a date of birth it does not ask for.
    expect(w.text()).toContain(APPLY_COPY.identity.introPartOne);
    expect(w.text()).not.toContain(APPLY_COPY.identity.intro);
  });

  it("asks everything on a legacy link, as before", () => {
    const w = mount(ApplicantDetailsFields, { props: { modelValue: draftWith() } });
    expect(w.find("[data-part-one-facts]").exists()).toBe(false);
    expect(w.find("#apply-phone").exists()).toBe(true);
  });
});

describe("Your licences", () => {
  it("is Part 1's licences, shown, with nothing to type", () => {
    const w = mount(LicenceFields, { props: { modelValue: draftWith(), partOne: FACTS } });
    expect(w.text()).toContain("Illinois · IL123 · Class A");
    expect(w.findAll("input").filter((i) => i.attributes("id")?.startsWith("apply-"))).toHaveLength(0);
  });

  it("asks the licence on a legacy link, as before", () => {
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

  it("is under the facts on both screens", () => {
    for (const screen of [ApplicantDetailsFields, LicenceFields]) {
      const w = mount(screen, { props: { modelValue: draftWith(), partOne: FACTS } });
      expect(w.find("[data-part-one-facts]").text()).toContain(copy.tellUs);
    }
  });
});

describe("the current address", () => {
  const STREET = { line1: "1 Main St", line2: "", city: "Joliet", state: "IL", postal_code: "60431" };
  const panel = (address: DraftAddress | null) =>
    mount(AddressDrawer, {
      props: { open: true, index: 1, address, currentStreet: STREET },
      global: { stubs: { SlideOver: SlideOverStub } },
      attachTo: document.body,
    });

  it("is Part 1's street, shown; only its months are asked, and it saves with Part 1's street", async () => {
    const w = panel({ ...emptyAddress(), line1: "typed", city: "typed", from: "2024-06" });
    expect(w.find("[data-current-street]").text()).toContain("1 Main St");
    expect(w.find("#apply-addresses-1-line1").exists()).toBe(false);
    expect(w.find("#apply-addresses-1-from").exists()).toBe(true);
    await button(w, APPLY_COPY.addresses.drawerSave)!.trigger("click");
    expect(w.emitted("save")![0]![0]).toEqual({ ...STREET, from: "2024-06", to: "" });
    w.unmount();
  });

  it("asks the whole address for an earlier one, which is the applicant's", () => {
    const w = panel({ ...emptyAddress(), line1: "9 Old Rd", city: "Gary", state: "IN", postal_code: "46402", from: "2020-01", to: "2024-05" });
    expect(w.find("[data-current-street]").exists()).toBe(false);
    expect(w.find("#apply-addresses-1-line1").exists()).toBe(true);
    w.unmount();
  });

  it("puts the note on the address screen when the current street is Part 1's", () => {
    const at = (partOne: PartOneFactsView | null) =>
      mount(AddressHistoryFields, {
        props: { modelValue: draftWith(), asOf: "2026-09-27", v2AsOf: "2026-09-27", partOne },
        global: { stubs: { SlideOver: SlideOverStub } },
      }).text();
    expect(at(FACTS)).toContain(copy.tellUs);
    expect(at(null)).not.toContain(copy.tellUs);
  });
});

describe("the driving record", () => {
  it("does not ask §40.25(j) again when Part 1 answered it", () => {
    const text = (askPriorTest?: boolean) =>
      mount(SafetyHistoryFields, { props: { modelValue: draftWith(), ...(askPriorTest === undefined ? {} : { askPriorTest }) } }).text();
    expect(text(false)).not.toContain(APPLY_COPY.safety.priorTest);
    expect(text()).toContain(APPLY_COPY.safety.priorTest);
  });
});

describe("ApplySection hands the facts to every screen that shows one", () => {
  const at = (section: "identity" | "licence" | "addresses" | "safety", partOne: PartOneFactsView | null) =>
    mount(ApplySection, {
      props: { modelValue: draftWith(), section, token: "t", captures: [], asOf: "2026-09-27", v2AsOf: "2026-09-27", partOne, identityLockedBy: null },
      global: { stubs: { SlideOver: SlideOverStub } },
    });
  it("to About you, Your licences and the address screen", () => {
    expect(at("identity", FACTS).findComponent(ApplicantDetailsFields).props("partOne")).toEqual(FACTS);
    expect(at("licence", FACTS).findComponent(LicenceFields).props("partOne")).toEqual(FACTS);
    expect(at("addresses", FACTS).findComponent(AddressHistoryFields).props("partOne")).toEqual(FACTS);
  });
  it("and stops the driving record asking §40.25(j) only when there are facts", () => {
    expect(at("safety", FACTS).findComponent(SafetyHistoryFields).props("askPriorTest")).toBe(false);
    expect(at("safety", null).findComponent(SafetyHistoryFields).props("askPriorTest")).toBe(true);
  });
});
