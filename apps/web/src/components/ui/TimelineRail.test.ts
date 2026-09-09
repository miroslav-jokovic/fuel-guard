import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TimelineRail, { type TimelineEntry } from "./TimelineRail.vue";

/**
 * The promoted rail (D-DS18; INVENTORY-PLAN.md I8).
 *
 * What is pinned here is only what the component OWNS — the ordering, the collapse, the day
 * grouping and the refusal to render an empty rail. Its content is the caller's, which is the whole
 * reason the promotion produced this shape rather than a generalised near-miss panel: the two
 * consumers share the rail and not one word of what hangs off it.
 */

const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 8, day, hour)).toISOString();
const entries = (n: number, day = (i: number) => i + 1): TimelineEntry[] =>
  Array.from({ length: n }, (_, i) => ({ key: `e${i}`, at: at(day(i)) }));

const rail = (props: Record<string, unknown>) =>
  mount(TimelineRail, {
    props: props as never,
    slots: { entry: `<template #entry="{ entry }"><span class="row">{{ entry.key }}</span></template>` },
  });

const keys = (w: ReturnType<typeof rail>) => w.findAll(".row").map((r) => r.text());

describe("the rail", () => {
  it("renders nothing at all when there is nothing to show", () => {
    // An empty rail is furniture that reports a finding: it reads as "something should be here".
    expect(rail({ entries: [] }).find("ol").exists()).toBe(false);
  });

  /**
   * Sorted here rather than trusting the payload, so an upstream change to a query's ordering cannot
   * silently reverse the display — and the fixture arrives DELIBERATELY out of order, because a
   * pre-sorted one would pass against a component that did no sorting at all.
   */
  it("puts the newest first whatever order it was handed", () => {
    const shuffled: TimelineEntry[] = [
      { key: "middle", at: at(2) },
      { key: "oldest", at: at(1) },
      { key: "newest", at: at(3) },
    ];
    expect(keys(rail({ entries: shuffled }))).toEqual(["newest", "middle", "oldest"]);
  });

  it("reads forwards when asked to", () => {
    const shuffled: TimelineEntry[] = [
      { key: "middle", at: at(2) },
      { key: "oldest", at: at(1) },
      { key: "newest", at: at(3) },
    ];
    expect(keys(rail({ entries: shuffled, order: "oldest" }))).toEqual(["oldest", "middle", "newest"]);
  });

  it("collapses past its threshold and expands on the button", async () => {
    const w = rail({ entries: entries(12), collapseAfter: 8 });
    expect(keys(w)).toHaveLength(8);
    expect(w.text()).toContain("Show all 12");
    await w.find("button").trigger("click");
    expect(keys(w)).toHaveLength(12);
  });

  /**
   * Zero never collapses, and that is the asset history's case: its page is paginated by the API, so
   * hiding half of it behind a second click would make the pager lie about what is on screen.
   */
  it("never collapses when no threshold is given", () => {
    const w = rail({ entries: entries(40) });
    expect(keys(w)).toHaveLength(40);
    expect(w.find("button").exists()).toBe(false);
  });

  it("groups into day headers only when asked, one per day and not one per row", () => {
    // Two entries on one day, one on the next — so a component emitting a header per ROW reads 3.
    const rows: TimelineEntry[] = [
      { key: "a", at: at(1, 9) },
      { key: "b", at: at(1, 14) },
      { key: "c", at: at(2, 9) },
    ];
    expect(rail({ entries: rows }).findAll("p.sticky")).toHaveLength(0);
    expect(rail({ entries: rows, groupByDay: true }).findAll("p.sticky")).toHaveLength(2);
  });

  it("tones the marker from what the caller passed, and leaves a neutral dot otherwise", () => {
    const w = rail({ entries: [{ key: "a", at: at(1), marker: "bg-warning-600" }, { key: "b", at: at(2) }] });
    const dots = w.findAll("span[aria-hidden='true']").map((d) => d.classes().join(" "));
    expect(dots.some((c) => c.includes("bg-warning-600"))).toBe(true);
    expect(dots.some((c) => c.includes("bg-edge-strong"))).toBe(true);
  });
});
