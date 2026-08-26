import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { CORRELATION_THRESHOLDS } from "@fuelguard/shared";
import CaseTimeline from "./CaseTimeline.vue";
import { nearMissMarker } from "@/lib/badges";
import type { NearMiss } from "./CaseTimeline.vue";

const at = (day: number, score: number, signals: string[] = []): NearMiss => ({
  fueledAt: `2026-08-${String(day).padStart(2, "0")}T12:00:00Z`,
  score,
  signals,
});

const mountWith = (entries: NearMiss[], total = entries.length, threshold = 40) =>
  mount(CaseTimeline, { props: { entries, total, threshold } });

describe("CaseTimeline (G3)", () => {
  it("renders newest first, whatever order the payload arrives in", () => {
    // The API sends oldest-first (`analyzeFills` walks an ascending query, then slices the tail).
    const w = mountWith([at(1, 41), at(9, 44), at(5, 42)]);
    const days = w.findAll("li").map((li) => li.text().match(/Aug (\d+)/)?.[1]);
    expect(days).toEqual(["9", "5", "1"]);
  });

  it("an empty window renders nothing at all, not an empty rail", () => {
    const w = mountWith([]);
    expect(w.find("ol").exists()).toBe(false);
    expect(w.text()).toBe("");
  });

  it("collapses past eight and expands on demand", async () => {
    const many = Array.from({ length: 12 }, (_, i) => at(i + 1, 41));
    const w = mountWith(many);
    expect(w.findAll("li")).toHaveLength(8);
    const button = w.find("button");
    expect(button.text()).toBe("Show all 12");
    await button.trigger("click");
    expect(w.findAll("li")).toHaveLength(12);
    expect(w.find("button").text()).toBe("Show fewer");
  });

  it("eight or fewer needs no toggle", () => {
    const w = mountWith(Array.from({ length: 8 }, (_, i) => at(i + 1, 41)));
    expect(w.findAll("li")).toHaveLength(8);
    expect(w.find("button").exists()).toBe(false);
  });

  it("marker fill comes from badges.ts, and turns at the lone-review weight", () => {
    const below = CORRELATION_THRESHOLDS.review - 1;
    const w = mountWith([at(2, CORRELATION_THRESHOLDS.review), at(1, below)]);
    const markers = w.findAll("li span[aria-hidden='true']");
    // Newest first, so the at-threshold entry is rendered first.
    expect(markers[0]!.attributes("class")).toContain(nearMissMarker(CORRELATION_THRESHOLDS.review));
    expect(markers[1]!.attributes("class")).toContain(nearMissMarker(below));
    // And the two are genuinely different, or the assertion above proves nothing.
    expect(nearMissMarker(CORRELATION_THRESHOLDS.review)).not.toBe(nearMissMarker(below));
  });

  it("says so when the API truncated the window rather than implying a total", () => {
    // entityRisk.ts caps the payload at the most recent 20; a busy truck holds more.
    const w = mountWith(Array.from({ length: 20 }, (_, i) => at(i + 1, 41)), 35);
    expect(w.text()).toContain("most recent 20 of 35");
  });

  it("does not claim truncation when the window is complete", () => {
    const w = mountWith([at(1, 41), at(2, 42)], 2);
    expect(w.text()).not.toContain("most recent");
  });

  it("shows the threshold the API applied, not a hardcoded one", () => {
    const w = mountWith([at(1, 55)], 1, 55);
    expect(w.text()).toContain("scoring ≥ 55");
  });

  it("renders signal labels through the real catalogue, never the raw rule id", () => {
    // A real id with a label that is NOT its title-cased form, so this cannot pass on the fallback:
    // `odometer_regression` maps to "Odometer Regression" via RULE_LABELS in catalog.generated.ts.
    const w = mountWith([at(1, 41, ["odometer_regression"])]);
    expect(w.text()).toContain("Odometer Regression");
    expect(w.text()).not.toContain("odometer_regression");
  });

  it("renders several signals on one entry, comma separated", () => {
    const w = mountWith([at(1, 41, ["odometer_regression", "odometer_stale"])]);
    expect(w.find("li p")!.text()).toBe("Odometer Regression, Stale Odometer");
  });
});
