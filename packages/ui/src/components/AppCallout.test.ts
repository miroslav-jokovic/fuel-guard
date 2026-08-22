import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { ShieldCheckIcon } from "../icons.js";
import AppCallout from "./AppCallout.vue";

/**
 * `AppCallout` (UI plan U4, D-UI4).
 *
 * ⚠ The load-bearing assertion is that every tone emits a LITERAL class string. Tailwind scans
 * source text for class names, so `bg-${tone}-50` is never emitted and the callout renders
 * transparent — a failure that reads as a styling nit and is actually an invisible warning on a
 * compliance page. A refactor to "tidy up" the static map is exactly what this catches.
 */
const TONES = ["brand", "info", "caution", "warning", "danger", "success"] as const;

describe("AppCallout", () => {
  it.each(TONES)("emits literal, purge-safe classes for tone=%s", (tone) => {
    const classes = mount(AppCallout, { props: { tone }, slots: { default: "x" } }).classes();
    expect(classes).toContain(`bg-${tone}-50`);
    expect(classes).toContain(`ring-${tone}-100`);
    expect(classes).toContain(`text-${tone}-800`);
  });

  it("defaults to info rather than rendering untoned", () => {
    expect(mount(AppCallout, { slots: { default: "x" } }).classes()).toContain("bg-info-50");
  });

  it("uses only named elevation-free surface tokens", () => {
    const classes = mount(AppCallout, { slots: { default: "x" } }).classes();
    // Generic shadows and raw palette hues both fail `lint:tokens`; the callout is a tinted
    // surface with a ring, never a raised card.
    expect(classes).toContain("rounded-surface");
    expect(classes.some((c) => c.startsWith("shadow-"))).toBe(false);
  });

  it("renders its message, and an icon only when given one", () => {
    const plain = mount(AppCallout, { slots: { default: "Nothing is missing." } });
    expect(plain.text()).toContain("Nothing is missing.");
    expect(plain.find("svg").exists()).toBe(false);

    const withIcon = mount(AppCallout, { props: { icon: ShieldCheckIcon }, slots: { default: "x" } });
    expect(withIcon.find("svg").exists()).toBe(true);
  });

  it("puts actions after the message so it reads statement-then-remedy", () => {
    const w = mount(AppCallout, {
      slots: { default: "3 drivers have no file.", actions: "<button>Set up files</button>" },
    });
    const text = w.text();
    expect(text.indexOf("3 drivers")).toBeLessThan(text.indexOf("Set up files"));
  });
});
