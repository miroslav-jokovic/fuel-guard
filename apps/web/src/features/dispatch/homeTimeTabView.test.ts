import { describe, expect, it } from "vitest";
import type { HomeTimePeriod, HomeTimeState } from "@silvicom/shared";
import { filterHomeTimes, homeTimeStateOptions, tabState } from "./homeTimeTabView";

const period = (driverName: string, state: HomeTimeState, unitNumber: string | null = null) =>
  ({ id: driverName, driverId: driverName, driverName, unitNumber, state, markedByName: "Ana Office" }) as HomeTimePeriod;

const live = [period("Leonard", "active", "676"), period("Mara", "overdue", "412"), period("Ivo", "scheduled", "1676"), period("Kim", "active", null)];
const recent = [period("Ben", "ended", "300"), period("Eli", "canceled", "301")];

describe("the Home time tab's filters (HOME-TIME-VISIBILITY-PLAN D-HT23, HV3)", () => {
  it("narrows each list to one of its own states", () => {
    expect(filterHomeTimes(live, { show: "live", term: "", state: "overdue" }).map((p) => p.driverName)).toEqual(["Mara"]);
    expect(filterHomeTimes(live, { show: "live", term: "", state: "active" }).map((p) => p.driverName)).toEqual(["Leonard", "Kim"]);
    expect(filterHomeTimes(recent, { show: "recent", term: "", state: "canceled" }).map((p) => p.driverName)).toEqual(["Eli"]);
  });

  it("ignores a state the list does not hold, so a stale or hand-edited link shows the whole list", () => {
    expect(tabState("recent", "overdue")).toBe("");
    expect(tabState("live", "banana")).toBe("");
    expect(filterHomeTimes(recent, { show: "recent", term: "", state: "overdue" })).toHaveLength(2);
  });

  it("searches a truck as a unit: 676 is Leonard, not Ivo's 1676", () => {
    expect(filterHomeTimes(live, { show: "live", term: "676", state: "" }).map((p) => p.driverName)).toEqual(["Leonard"]);
  });

  it("counts each option with the search applied, so the number is the rows it leaves", () => {
    expect(homeTimeStateOptions(live, { show: "live", term: "" }).map((o) => o.label)).toEqual(["All (4)", "Overdue (1)", "Home (2)", "Scheduled (1)"]);
    expect(homeTimeStateOptions(live, { show: "live", term: "676" }).map((o) => o.label)).toEqual(["All (1)", "Overdue (0)", "Home (1)", "Scheduled (0)"]);
    expect(homeTimeStateOptions(recent, { show: "recent", term: "" }).map((o) => o.label)).toEqual(["All (2)", "Ended (1)", "Canceled (1)"]);
  });
});
