import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppDelta from "./AppDelta.vue";

/**
 * The delta pill (DR2b). Three things it must hold: the direction is one glyph and the magnitude is
 * unsigned text (D-DT2), flat is a dash alone (D-DT4), and the verdict colour is whatever the
 * caller said, never read off the arrow (D-DT8).
 */
describe("AppDelta", () => {
  it("draws the arrow and the unsigned magnitude, and speaks the direction for a screen reader", () => {
    const w = mount(AppDelta, { props: { direction: "up", tone: "bad", label: "12%" } });
    const visible = w.findAll("[aria-hidden='true']").map((s) => s.text());
    expect(visible).toEqual(["↑", "12%"]);
    expect(w.find(".sr-only").text()).toBe("Up 12% versus the previous period");
  });

  it("draws a dash alone when flat, with no magnitude beside it (D-DT4)", () => {
    const w = mount(AppDelta, { props: { direction: "flat", tone: "neutral", label: "0.0%" } });
    expect(w.findAll("[aria-hidden='true']").map((s) => s.text())).toEqual(["—"]);
    expect(w.find(".sr-only").text()).toBe("No change versus the previous period");
  });

  it("wears the caller's tone, not one inferred from the arrow (D-DT8)", () => {
    const upGood = mount(AppDelta, { props: { direction: "up", tone: "good", label: "0.3" } });
    const upBad = mount(AppDelta, { props: { direction: "up", tone: "bad", label: "0.3" } });
    expect(upGood.find("span").classes().join(" ")).toContain("success");
    expect(upBad.find("span").classes().join(" ")).toContain("danger");
    expect(upGood.find("span").classes()).not.toEqual(upBad.find("span").classes());
  });

  it("names what the change is against when told", () => {
    const w = mount(AppDelta, { props: { direction: "down", tone: "good", label: "3.4%", against: "Jul 19 – Aug 18" } });
    expect(w.find(".sr-only").text()).toBe("Down 3.4% versus Jul 19 – Aug 18");
  });
});
