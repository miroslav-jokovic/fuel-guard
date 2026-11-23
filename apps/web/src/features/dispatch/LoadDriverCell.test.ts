import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import type { HomeTimePeriod } from "@silvicom/shared";
import LoadDriverCell from "./LoadDriverCell.vue";

/** A load assigned to a driver on home time says so on the Loads list (HOME-TIME-VISIBILITY-PLAN D-HT24). */
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", name: "assignments", component: { template: "<div />" } }] });
const row = { driver_id: "d1", driver_name: "ANA RUIZ", co_driver_id: "d2", co_driver_name: "BEN COLE", vehicle_unit: "676", trailer_unit: "T9" };
const period = (driverId: string, state: HomeTimePeriod["state"]) =>
  ({ id: `p-${driverId}`, driverId, driverName: driverId, state, startAt: "2026-11-16T21:32:00Z", expectedReturnAt: "2026-11-24T21:32:00Z" }) as HomeTimePeriod;
const cell = (homeTimes?: Map<string, HomeTimePeriod>, r: Partial<typeof row> = {}) =>
  mount(LoadDriverCell, { props: { row: { ...row, ...r }, homeTimes, zone: "America/Chicago" }, global: { plugins: [router] } });
const badges = (w: ReturnType<typeof cell>) => w.findAll("[data-home-time-badge]").map((b) => b.text());

describe("LoadDriverCell", () => {
  it("says each seat on home time, the second driver's too", () => {
    expect(badges(cell(new Map([["d2", period("d2", "scheduled")]])))).toEqual(["Home time from 11/16"]);
    expect(badges(cell(new Map([["d1", period("d1", "active")], ["d2", period("d2", "overdue")]])))).toEqual(["Home until 11/24", "Overdue since 11/24"]);
  });

  it("says it once when McLeod names the same driver in both seats", () => {
    expect(badges(cell(new Map([["d1", period("d1", "active")]]), { co_driver_id: "d1" }))).toEqual(["Home until 11/24"]);
  });

  it("says nothing to a reader handed no home time, and keeps the driver, team and truck lines", () => {
    const w = cell(undefined);
    expect(badges(w)).toEqual([]);
    expect(w.text()).toContain("ANA RUIZ");
    expect(w.text()).toContain("+ BEN COLE");
    expect(w.text()).toContain("676 / T9");
  });
});
