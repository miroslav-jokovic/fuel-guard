import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RouteSummary from "./RouteSummary.vue";
import type { PlanResult } from "./useFuelPlan";

/**
 * The route card's hours-of-service clocks (D-US6): four facts through `FactList`, so a clock the
 * truck did not report is the table's em dash rather than a hand-written one.
 */
const route: NonNullable<PlanResult["route"]> = { distanceMiles: 812, durationHours: 13.5, polyline: [], directions: [] };
const truck: NonNullable<PlanResult["truck"]> = {
  fuelPct: 62, gallonsOnHand: 124, tankCapacityGal: 200, driveRemainingHours: 7.5, breakInHours: null,
  shiftRemainingHours: 9, cycleRemainingHours: 41, reachableMiles: 380, fuelRangeMiles: 900,
};

describe("RouteSummary", () => {
  it("pairs each HOS clock with its value through FactList, and an unreported clock is a dash", () => {
    const w = mount(RouteSummary, { props: { route, truck } });
    const list = w.get("[data-testid=route-hos-clocks]");
    expect(list.findAll("dt").map((d) => d.text())).toEqual(["Drive", "Break in", "Shift", "Cycle"]);
    expect(list.findAll("dd").map((d) => d.text())).toEqual(["7.5h", "—", "9h", "41h"]);
  });

  it("draws no clocks without a truck", () => {
    const w = mount(RouteSummary, { props: { route } });
    expect(w.find("[data-testid=route-hos-clocks]").exists()).toBe(false);
  });
});
