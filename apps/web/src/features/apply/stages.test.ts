import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ApplyStages from "./ApplyStages.vue";
import { currentStage, stageStates } from "./stages";
import { APPLY_COPY } from "./strings";

/** The three stages of an application (U1): which one a link is in, and how the bar says so. */
const facts = (over: Partial<Parameters<typeof currentStage>[0]> = {}) =>
  ({ applicationSent: false, approved: false, submitted: false, ...over });

describe("which stage a link is in", () => {
  it("is Today until the office sends the application", () => {
    expect(currentStage(facts())).toBe("today");
    expect(stageStates(facts())).toEqual({ today: "current", history: "ahead", signing: "ahead" });
  });

  it("is Your history once it is sent, and through the office's reading of it", () => {
    expect(stageStates(facts({ applicationSent: true }))).toEqual({ today: "done", history: "current", signing: "ahead" });
  });

  it("is Signing once the office has read it", () => {
    expect(stageStates(facts({ applicationSent: true, approved: true }))).toEqual({ today: "done", history: "done", signing: "current" });
  });

  it("has every stage behind it once filed", () => {
    expect(stageStates(facts({ applicationSent: true, submitted: true }))).toEqual({ today: "done", history: "done", signing: "done" });
  });
});

describe("the bar on every screen", () => {
  it("names the three, marks the one the driver is in, and offers nothing to tap", () => {
    const w = mount(ApplyStages, { props: { facts: facts({ applicationSent: true }) } });
    const items = w.findAll("li");
    expect(items.map((li) => li.attributes("data-state"))).toEqual(["done", "current", "ahead"]);
    expect(items[1]!.attributes("aria-current")).toBe("step");
    expect(items[0]!.attributes("aria-current")).toBeUndefined();
    expect(w.text()).toContain(APPLY_COPY.stages.names.history);
    expect(items[1]!.text()).toContain(APPLY_COPY.stages.state.current);
    expect(w.findAll("button, a")).toHaveLength(0);
  });
});
