import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { emptyDraft } from "./draft";
import ApplySection from "./ApplySection.vue";
import EmployerDrawer from "./EmployerDrawer.vue";
import AddressHistoryFields from "./AddressHistoryFields.vue";
import { APPLY_COPY } from "./strings";

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

  it("hands the employment screen's job panel the v2 day, and a legacy link none (C3c2b)", () => {
    const panelDay = (v2AsOf?: string | null) =>
      mount(ApplySection, {
        props: { modelValue: emptyDraft(), section: "employment", token: "t", captures: [], asOf: "2026-09-26", v2AsOf, identityLockedBy: null },
      }).findComponent(EmployerDrawer).props("v2AsOf");
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
});
