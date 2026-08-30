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

  it("aligns the box to the first line, not the middle of a wrapped label", () => {
    const cls = mountBox().find("label").classes();
    expect(cls).toContain("items-start");
    expect(cls).not.toContain("items-center");
    // …and the box keeps the vertical position `min-h-9 items-center` gave it on one line.
    expect(mountBox().find("input").classes()).toContain("mt-2.5");
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
