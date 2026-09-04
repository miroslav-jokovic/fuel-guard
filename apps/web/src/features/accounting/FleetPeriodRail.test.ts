import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FleetPeriodRail from "./FleetPeriodRail.vue";
import { periodForCustom, periodForMonth, periodForQuarter, type ReportPeriod } from "@/lib/reportPeriod";

/**
 * The rail, mounted (D-FRUI1). What is pinned is what a reader operates: the arrows step the
 * period and emit it, the forward arrow refuses to pass the cap, the grain control re-expresses
 * the period without losing the month it ended in, and a custom pick arrives as whole months.
 */
const mountRail = (period: ReportPeriod, cap = "2026-07") =>
  mount(FleetPeriodRail, {
    props: { modelValue: period, cap },
    global: { stubs: { DateRangeFilter: { template: "<div data-test='date-range' />" } } },
  });

const arrow = (w: ReturnType<typeof mountRail>, label: string) =>
  w.findAll("button").find((b) => b.attributes("aria-label")?.startsWith(label))!;

describe("FleetPeriodRail", () => {
  it("names the period and steps it back a month", async () => {
    const w = mountRail(periodForMonth("2026-07"));
    expect(w.text()).toContain("July 2026");
    await arrow(w, "Previous").trigger("click");
    expect(w.emitted("update:modelValue")?.at(-1)?.[0]).toEqual(periodForMonth("2026-06"));
  });

  it("will not step forward past the cap, and says why the arrow is off", async () => {
    const w = mountRail(periodForMonth("2026-07"));
    const next = arrow(w, "Next");
    expect(next.attributes("disabled")).toBeDefined();
    await next.trigger("click");
    expect(w.emitted("update:modelValue")).toBeUndefined();
    const earlier = mountRail(periodForMonth("2026-06"));
    expect(arrow(earlier, "Next").attributes("disabled")).toBeUndefined();
  });

  it("steps a quarter by a quarter and labels the arrows for it", async () => {
    const w = mountRail(periodForQuarter("2026-07"), "2026-09");
    expect(w.text()).toContain("Q3 2026");
    expect(arrow(w, "Previous quarter").exists()).toBe(true);
    await arrow(w, "Previous quarter").trigger("click");
    expect(w.emitted("update:modelValue")?.at(-1)?.[0]).toEqual(periodForQuarter("2026-04"));
  });

  it("changes grain around the month the period ends in", async () => {
    const w = mountRail(periodForMonth("2026-07"));
    const quarter = w.findAll('[role="radio"]').find((r) => r.text() === "Quarter")!;
    await quarter.trigger("click");
    expect(w.emitted("update:modelValue")?.at(-1)?.[0]).toEqual(periodForQuarter("2026-07"));
  });

  it("shows the month picker only for a custom range, and disables the stepper there", () => {
    const monthly = mountRail(periodForMonth("2026-07"));
    expect(monthly.find("[data-test='date-range']").exists()).toBe(false);
    const custom = mountRail(periodForCustom("2026-03-01", "2026-07-31"));
    expect(custom.find("[data-test='date-range']").exists()).toBe(true);
    expect(custom.text()).toContain("Mar – Jul 2026");
    expect(arrow(custom, "Previous").attributes("disabled")).toBeDefined();
  });
});
