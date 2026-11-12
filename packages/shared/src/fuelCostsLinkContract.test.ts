import { describe, expect, it } from "vitest";
import { FUEL_COSTS_QUERY_KEYS, fuelCostsToQuery } from "./fuelCostsLinkContract.js";

describe("fuelCostsToQuery — the Fuel Costs page's URL (F21 R4b)", () => {
  it("writes the window and every filter under the page's keys, lists comma-joined", () => {
    expect(
      fuelCostsToQuery({ from: "2026-07-01", to: "2026-09-30", vehicleIds: ["v1", "v2"], states: ["TX"], siteIds: ["s9"], networks: ["pilot_fj"] }),
    ).toEqual({ from: "2026-07-01", to: "2026-09-30", trucks: "v1,v2", states: "TX", sites: "s9", networks: "pilot_fj" });
  });

  it("leaves an empty list out, because on this page an empty list means all and `trucks=` would not", () => {
    expect(fuelCostsToQuery({ from: "2026-10-01", to: "2026-10-31", vehicleIds: [] })).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("names the six keys the page reads", () => {
    expect(Object.values(FUEL_COSTS_QUERY_KEYS)).toEqual(["from", "to", "trucks", "states", "sites", "networks"]);
  });
});
