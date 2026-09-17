import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppButton from "./AppButton.vue";

/**
 * The button primitive's SHAPE, which is the part call sites keep trying to override.
 *
 * ⚠ This file exists because of a pattern rather than a bug: three times now a caller has written
 * `!important` classes to undo this button's box — twice for an inline link (which became the `link`
 * variant), once for a square icon (the `icon` size), and once for a list row (`row`, D-DR25). Each
 * time `lint:template-integrity` refused it and each time the honest reading was that a variant was
 * missing. What that gate cannot check is that the variant it forced actually produces the shape the
 * call site needed, so these assert the three properties a row inverts.
 */
describe("AppButton size='row'", () => {
  const classesOf = (props: Record<string, unknown>) =>
    mount(AppButton, { props, slots: { default: "Unit 1207" } }).classes();

  /**
   * The three defaults a control has and a list row must not: centred, pill-cornered, semibold. A row
   * that kept any of them reads as a button sitting in a list rather than as a row of it.
   */
  it("inverts the control shape rather than layering over it", () => {
    const row = classesOf({ size: "row" });
    expect(row).toContain("justify-start");
    expect(row).toContain("font-normal");
    expect(row).not.toContain("justify-center");
    expect(row).not.toContain("font-semibold");
    expect(row).not.toContain("rounded-control");
  });

  // A row is as tall as its content — a driver's name and a place name are two lines, not one.
  it("takes its height from its content and its width from its column", () => {
    const row = classesOf({ size: "row" });
    expect(row).toContain("h-auto");
    expect(row).toContain("w-full");
    expect(row).toContain("whitespace-normal");
  });

  // ⚠ And the ordinary sizes are untouched by the branch that makes `row` possible.
  it("leaves every other size the control it was", () => {
    for (const size of ["sm", "md", "icon"] as const) {
      const cls = classesOf({ size });
      expect(cls, `${size} is still a control`).toContain("justify-center");
      expect(cls).toContain("rounded-control");
      expect(cls).toContain("font-semibold");
      expect(cls).toContain("whitespace-nowrap");
    }
  });

  it("still renders a real button, so a row is focusable and activatable", () => {
    const wrapper = mount(AppButton, { props: { size: "row" }, slots: { default: "Unit 1207" } });
    expect(wrapper.element.tagName).toBe("BUTTON");
    expect(wrapper.attributes("type")).toBe("button");
  });
});
