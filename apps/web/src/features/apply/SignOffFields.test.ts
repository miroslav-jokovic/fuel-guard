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
  mount(SignOffFields, { props: { token: "t", carrier: "Silvicom", edits: edits as never, captures: [], modelValue: emptyDraft() } });

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

  /**
   * E2: the office removed address 2 AFTER correcting address 3. The recorded "Address 3 · City" would
   * name an address the driver no longer has, so the change is named where it is now.
   */
  it("names a correction where it is now after the office removed an earlier row", () => {
    const OLD = { line1: "9 Old Rd", city: "Gary" };
    const w = mountWith([
      { path: ["addresses", 2, "city"], before: "Hammond", after: "Hammond IN", editedAt: "2026-11-10T10:00:00Z" },
      { path: ["addresses", 0, "city"], before: "Gary", after: "Gary IN", editedAt: "2026-11-10T10:01:00Z" },
      { path: ["addresses", 0], before: OLD, after: null, editedAt: "2026-11-10T10:02:00Z" },
    ]);
    const labels = w.findAll("li p.font-medium").map((p) => p.text());
    expect(labels[0]).toBe("Address 2 · City");
    expect(labels[1]).toBe(`Address 1 · City (${APPLY_COPY.signOff.removedLater})`);
    expect(labels[2]).toBe("Address 1");
    expect(w.text()).toContain("9 Old Rd, Gary");
  });
});
