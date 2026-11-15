import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import CountList, { type CountRow } from "./CountList.vue";

/**
 * A zero is quiet (SMALL-SCREENS-PLAN.md Q-SM1 (a)). It still renders — FLEET-MANAGER-HOME-PLAN §4:
 * "seeing that nothing is late is the point of looking" — on one line, and keeps its door (D-FM9).
 */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});
const RouterLink = { props: ["to"], template: '<a :href="to"><slot /></a>' };
const ROWS: CountRow[] = [
  { key: "late", label: "Late risk", value: 0, caption: "loads late or at risk of it", to: "/assignments?queue=late", door: "Review", alarm: true },
  { key: "gps", label: "No GPS", value: 102, caption: "trucks not reporting a position", to: "/assignments?queue=nogps", door: "Review" },
  { key: "mpg", label: "Fleet MPG", value: null, caption: "not measured yet" },
  { key: "clean", label: "Clean", value: 0, display: "—", caption: "0 of 0 with no violation" },
];
const render = () => mount(CountList, { props: { rows: ROWS }, global: { stubs: { RouterLink } } });

describe("CountList", () => {
  it("draws a zero on one line, without its caption, and keeps its door", () => {
    const row = render().findAll("li")[0]!;
    expect(row.attributes("data-quiet")).toBeDefined();
    expect(row.text()).toContain("Late risk");
    expect(row.get('[data-test="count-late"]').text()).toBe("0");
    expect(row.text()).not.toContain("loads late or at risk of it");
    expect(row.get("a").attributes("href")).toBe("/assignments?queue=late");
    // The door's words are still there for a screen reader, naming the row it opens.
    expect(row.get("a .sr-only").text()).toBe("Review: Late risk");
  });

  it("gives a row that holds a number its caption and its named door", () => {
    const row = render().findAll("li")[1]!;
    expect(row.attributes("data-quiet")).toBeUndefined();
    expect(row.get('[data-test="count-gps"]').text()).toBe("102");
    expect(row.text()).toContain("trucks not reporting a position");
    expect(row.get("a").text()).toContain("Review");
  });

  it("keeps the full row for a figure that is not known, because a dash needs its sentence", () => {
    const row = render().findAll("li")[2]!;
    expect(row.attributes("data-quiet")).toBeUndefined();
    expect(row.get('[data-test="count-mpg"]').text()).toBe("—");
    expect(row.text()).toContain("not measured yet");
    // A rate of nothing carries the number 0 and prints a dash — unknown, not zero.
    const rate = render().findAll("li")[3]!;
    expect(rate.attributes("data-quiet")).toBeUndefined();
    expect(rate.text()).toContain("0 of 0 with no violation");
  });
});
