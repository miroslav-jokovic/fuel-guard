import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppAvatar from "./AppAvatar.vue";

const initialsOf = (label: string | null | undefined) =>
  mount(AppAvatar, { props: { label } }).text();

describe("AppAvatar (G4)", () => {
  it("an email yields one letter, which is the only case the product actually has today", () => {
    expect(initialsOf("miroslav@fuelguard.io")).toBe("M");
    expect(initialsOf("dispatch.night@silvicom.com")).toBe("D");
  });

  it("a two-word name yields two, by the same rule and with no email special-casing", () => {
    expect(initialsOf("Marcus Reyes")).toBe("MR");
  });

  it("three words take the first and the last, not the middle", () => {
    expect(initialsOf("Ana Maria Reyes")).toBe("AR");
  });

  it("punctuation never reaches the circle", () => {
    expect(initialsOf('"Reyes, Marcus"')).toBe("RM");
    expect(initialsOf("  spaced   out  ")).toBe("SO");
  });

  it("an absent or empty label degrades to a question mark rather than an empty circle", () => {
    expect(initialsOf(null)).toBe("?");
    expect(initialsOf(undefined)).toBe("?");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf("!!!")).toBe("?");
  });

  it("is decorative: it contributes no accessible name, so an enclosing labelled control is not read twice", () => {
    // Both call sites sit inside a KebabMenu whose trigger already announces the address. See the
    // component header — this deliberately departs from what UI-GAPS-PLAN.md §5 specified.
    const w = mount(AppAvatar, { props: { label: "miroslav@fuelguard.io" } });
    expect(w.element.getAttribute("aria-hidden")).toBe("true");
    expect(w.element.getAttribute("aria-label")).toBeNull();
    expect(w.element.getAttribute("title")).toBeNull();
  });

  it("the two sizes are the two the sidebar uses, collapsed and expanded", () => {
    expect(mount(AppAvatar, { props: { label: "a", size: "sm" } }).classes()).toContain("size-7");
    expect(mount(AppAvatar, { props: { label: "a" } }).classes()).toContain("size-8");
  });

  it("carries the treatment that used to live in the web stylesheet", () => {
    const cls = mount(AppAvatar, { props: { label: "a" } }).classes();
    for (const c of ["bg-surface-muted", "text-ink", "ring-edge", "rounded-full", "shrink-0"]) {
      expect(cls, c).toContain(c);
    }
  });
});
