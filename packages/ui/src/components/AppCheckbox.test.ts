import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppCheckbox from "./AppCheckbox.vue";

/**
 * `AppCheckbox`.
 *
 * ⚠ What is pinned here is that the root is BLOCK-LEVEL, because the bug this replaces was invisible
 * to every other kind of check. As `inline-flex` the component type-checked, passed the token gate,
 * rendered the right control and read correctly in a narrow column — and then ran three options
 * together into one line the moment the window was wide enough to fit two of them, while the
 * `space-y-*` the author wrote on the wrapper silently did nothing, because vertical margins do not
 * apply to inline-level boxes.
 */
const mountBox = (slot = "Residue only — the packaging is empty but not cleaned") =>
  mount(AppCheckbox, { props: { modelValue: false }, slots: { default: slot } });

describe("AppCheckbox layout contract", () => {
  it("is block-level, so stacked options cannot share a line", () => {
    const cls = mountBox().find("label").classes();
    expect(cls).toContain("flex");
    expect(cls).not.toContain("inline-flex");
  });

  /**
   * ⚠ This assertion previously read `mt-2.5`, and pinned a bug rather than a contract.
   *
   * The reasoning behind that value took where `min-h-9 items-center` had put the box — centred in
   * the 36px ROW — and kept the offset after the switch to `items-start`. But `items-start` moves
   * the LABEL to the top of the row too, so the box was aligned against a position the text no
   * longer occupied, and sat 8px below its own label on every page that stacks options. A class
   * assertion cannot see that; it was measured in the design-system lab, where the checkbox now
   * appears for exactly this reason: first line top 1px, height 18px, centre 10px, so a 16px box
   * starts at 2px.
   *
   * The number is asserted rather than the alignment because a unit test has no layout. The lab is
   * where the claim is checked; this is what stops it silently drifting back.
   */
  it("aligns the box to the first line, not the middle of a wrapped label", () => {
    const cls = mountBox().find("label").classes();
    expect(cls).toContain("items-start");
    expect(cls).not.toContain("items-center");
    expect(mountBox().find("input").classes()).toContain("mt-0.5");
    expect(mountBox().find("input").classes()).not.toContain("mt-2.5");
  });

  it("never lets a long label squeeze the box", () => {
    expect(mountBox().find("input").classes()).toContain("shrink-0");
  });
});

describe("AppCheckbox behaviour", () => {
  it("emits the new checked state", async () => {
    const w = mountBox();
    const input = w.find("input");
    await input.setValue(true);
    expect(w.emitted("update:modelValue")?.[0]).toEqual([true]);
  });

  it("renders the slot, and falls back to the label prop", () => {
    expect(mountBox("Marked “Limited Quantity” on the BOL").text()).toContain("Limited Quantity");
    const w = mount(AppCheckbox, { props: { modelValue: false, label: "Residue only" } });
    expect(w.text()).toContain("Residue only");
  });
});
