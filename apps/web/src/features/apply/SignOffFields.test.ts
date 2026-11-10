import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SignOffFields from "./SignOffFields.vue";
import { emptyDraft } from "./draft";
import { APPLY_COPY } from "./strings";

/**
 * What the driver is shown of the office's corrections before they sign (D-AX12; F3, Q-AM13).
 *
 * ⚠ The two F3 rows are the ones worth pinning: a replace-only answer (the drug-test gender) is said to
 * have been replaced and is never printed on a screen others may read, and the office's reason for
 * changing one of the driver's own statements is printed beside it — the driver is accepting a change
 * to their own sworn answer, and they are owed the why.
 */
const mountWith = (edits: unknown[]) =>
  mount(SignOffFields, { props: { carrier: "Silvicom", edits: edits as never, captures: [], modelValue: emptyDraft() } });

describe("what the carrier changed", () => {
  it("prints the office's reason beside a change to the driver's own statement", () => {
    const w = mountWith([{ path: ["prior_failed_pre_employment_test"], before: false, after: true, note: "You told us on the phone", withheld: false, editedAt: "2026-11-10T12:00:00Z" }]);
    expect(w.find("[data-edit-note]").text()).toContain(`${APPLY_COPY.signOff.because}: You told us on the phone`);
    expect(w.text()).toContain(APPLY_COPY.signOff.now);
  });

  it("⚠ says a replace-only answer was replaced and prints neither value", () => {
    const w = mountWith([{ path: ["donor_gender"], before: null, after: null, note: null, withheld: true, editedAt: "2026-11-10T12:00:00Z" }]);
    expect(w.find("[data-edit-withheld]").text()).toBe(APPLY_COPY.signOff.replaced);
    expect(w.text()).not.toContain(APPLY_COPY.signOff.was);
    expect(w.find("[data-edit-note]").exists()).toBe(false);
  });

  it("prints a changed endorsement list as its codes, not as JSON", () => {
    const w = mountWith([{ path: ["endorsements"], before: ["N"], after: ["H", "N"], note: null, withheld: false, editedAt: "2026-11-10T12:00:00Z" }]);
    expect(w.text()).toContain("H, N");
    expect(w.text()).not.toContain("[");
  });
});
