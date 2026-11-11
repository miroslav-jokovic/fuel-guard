import { describe, expect, it } from "vitest";
import { LOADS_QUERY_KEYS, loadsToQuery } from "./loadsLinkContract.js";

describe("loadsToQuery — the Loads page's URL (F21 R4b)", () => {
  it("writes the tab, the inclusive delivered days, one truck and one driver by id, and the scope", () => {
    expect(loadsToQuery({ queue: "delivered", deliveredFrom: "2026-10-01", deliveredTo: "2026-10-31", vehicleId: "v1", driverId: "d1", scope: "all" })).toEqual({
      queue: "delivered", delivered_from: "2026-10-01", delivered_to: "2026-10-31", truck: "v1", driver: "d1", scope: "all",
    });
  });

  it("leaves out what is not given, so the page's own default holds", () => {
    expect(loadsToQuery({ queue: "delivered", deliveredFrom: "2026-10-01", deliveredTo: "2026-10-31", vehicleId: null })).toEqual({
      queue: "delivered", delivered_from: "2026-10-01", delivered_to: "2026-10-31",
    });
    expect(loadsToQuery({})).toEqual({});
  });

  it("names the keys the page reads, never the API's exclusive `delivered_before`", () => {
    expect(Object.values(LOADS_QUERY_KEYS)).toEqual(["queue", "delivered_from", "delivered_to", "truck", "driver", "scope"]);
  });
});
