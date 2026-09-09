import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppBadge from "./AppBadge.vue";

/**
 * The badge pill (contract §7.1).
 *
 * ── ⚠ THE ASSERTION THIS FILE EXISTS FOR ─────────────────────────────────────────────────────
 * **It must not transform the case of its label.** It carried `capitalize` until 2026-09-09, which
 * title-cased every word inside it — so a two-word label read correctly in the source and wrongly
 * on screen, and no test anywhere could see it. It cost three separate workarounds before anybody
 * connected them: INVENTORY-PLAN.md's I5 renamed "Not counted" to the one word "Uncounted" to dodge
 * it, I8 moved the asset status pills off this primitive because there is no one-word way to say
 * "In repair", and I5's own review badge shipped "Recount By Someone Else" to the shop for a week.
 *
 * A class assertion rather than a rendered-text one, deliberately: jsdom applies no stylesheet, so
 * `text-transform` is invisible to `innerText` and an assertion on the words would pass against the
 * broken primitive. The class list is where the defect actually lived.
 */
describe("AppBadge", () => {
  it("carries no case transform, because labels own their casing", () => {
    const w = mount(AppBadge, { slots: { default: "In repair" } });
    const classes = w.find("span").classes();
    expect(classes).not.toContain("capitalize");
    expect(classes).not.toContain("uppercase");
    expect(classes).not.toContain("lowercase");
  });

  it("renders the label it was given, word for word", () => {
    expect(mount(AppBadge, { slots: { default: "Recount by someone else" } }).text()).toBe(
      "Recount by someone else",
    );
  });

  it("still tones itself from the prop", () => {
    const danger = mount(AppBadge, { props: { tone: "danger" }, slots: { default: "Lost" } });
    expect(danger.find("span").classes().join(" ")).toContain("danger");
  });
});
