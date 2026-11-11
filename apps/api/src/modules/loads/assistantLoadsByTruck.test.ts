import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadsToQuery } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Ask AI's `loads_by_truck` (F21 R6b). Its header promises the counts are the Loads page's Delivered
 * tab — `listLoads` asked with the page's own delivery instants, kept to the `delivered` queue, counted
 * per truck — and the miles are McLeod's per-load figures, summed, with the loads that carry none
 * counted rather than read as zero. So `listLoads` is a spy that answers rows the page would NOT put on
 * the Delivered tab (in transit, canceled) beside delivered ones, with fractional miles a rounding of
 * the per-load figures could not reproduce.
 */
const listLoads = vi.fn();
const loadsHistoryFrom = vi.fn();
vi.mock("./dispatchLoads/queries.js", () => ({ listLoads: (...a: unknown[]) => listLoads(...a) }));
vi.mock("./dispatchLoads/deliveredWindow.js", () => ({ loadsHistoryFrom: (...a: unknown[]) => loadsHistoryFrom(...a) }));
const { assistantLoadsByTruck, LOADS_SOURCE } = await import("./assistantLoadsByTruck.js");

const ORG = "org-1";
const NOV_10 = new Date("2026-11-10T15:00:00Z");

const load = (vehicle: string | null, status: string, miles: number | string | null, extra: Record<string, unknown> = {}) => ({
  id: `l-${Math.random()}`,
  status,
  source: "tms",
  external_status: status === "delivered" ? "D" : "P",
  driver_id: "d1",
  vehicle_id: vehicle ? `v${vehicle}` : null,
  vehicle_unit: vehicle,
  total_miles: miles,
  loaded: true,
  external_synced_at: "2026-11-10T14:00:00Z",
  ...extra,
});

const ROWS = [
  load("748", "delivered", 512.4),
  load("748", "delivered", 300.4),
  load("748", "delivered", null),
  load("748", "delivered", 41.2, { loaded: false }),
  load("748", "in_transit", 999), // on the board, not on the Delivered tab
  load("751", "delivered", "1210.6", { external_synced_at: "2026-11-10T14:30:00Z" }),
  load("751", "canceled", 800), // All only
  load(null, "delivered", 220),
  load("762", "delivered", 88.8),
  load("762", "delivered", 90.1),
];

const recorder = () =>
  createSupabaseRecorder({
    tables: {
      organizations: [{ operating_hours: { tz: "America/Chicago" } }],
      vehicles: [
        { id: "v748", unit_number: "748" },
        { id: "v751", unit_number: "751" },
        { id: "v762", unit_number: "762" },
        { id: "v800", unit_number: "800" },
      ],
    },
  });

beforeEach(() => {
  listLoads.mockReset();
  loadsHistoryFrom.mockReset();
  listLoads.mockResolvedValue(ROWS);
  loadsHistoryFrom.mockResolvedValue("2026-03-27T16:00:00Z");
});

describe("loads_by_truck — the Loads page's Delivered tab, counted per truck", () => {
  it("asks listLoads with the page's own delivery instants: the carrier's midnights, the end exclusive", async () => {
    const rec = recorder();
    await assistantLoadsByTruck(rec.client, ORG, { period: "last_month" }, NOV_10);
    expect(listLoads).toHaveBeenCalledTimes(1);
    expect(listLoads.mock.calls[0]!.slice(1)).toEqual([ORG, { from: "2026-10-01T05:00:00.000Z", before: "2026-11-01T05:00:00.000Z" }]);
    expect(loadsHistoryFrom.mock.calls[0]!.slice(1)).toEqual([ORG]);
    expectOrgScoped(rec, ORG);
  });

  it("counts only the Delivered tab's rows, per truck, and keeps the per-load miles McLeod's", async () => {
    const out = (await assistantLoadsByTruck(recorder().client, ORG, { period: "last_month" }, NOV_10)) as Out;
    expect(out).toMatchObject({
      source: LOADS_SOURCE,
      timezone: "America/Chicago",
      period: "last month",
      from: "2026-10-01",
      to: "2026-10-31",
      delivered_loads: 8,
      delivered_loads_without_a_truck: 1,
      trucks_with_deliveries: 3,
      mcleod_synced_at: "2026-11-10T14:30:00Z",
      delivery_history_begins: "2026-03-27T16:00:00Z",
    });
    expect(out.trucks).toEqual([
      // 512.4 + 300.4 + 41.2 = 854.0; the load with no miles is counted, never a zero.
      { unit: "748", delivered_loads: 4, empty_moves: 1, mcleod_miles: 854, loads_without_miles: 1 },
      { unit: "762", delivered_loads: 2, empty_moves: 0, mcleod_miles: 179, loads_without_miles: 0 },
      { unit: "751", delivered_loads: 1, empty_moves: 0, mcleod_miles: 1211, loads_without_miles: 0 },
    ]);
    expect(out.miles_are).toMatch(/Not measured miles/);
    expect(out.history_note).toBeUndefined();
  });

  it("named units: a unit of this fleet with no delivery is a real 0; a stranger is named back", async () => {
    const rec = recorder();
    const out = (await assistantLoadsByTruck(rec.client, ORG, { period: "last_month", units: ["Unit 751", "#800", "999"] }, NOV_10)) as Out;
    expect(out.trucks).toEqual([
      { unit: "751", delivered_loads: 1, empty_moves: 0, mcleod_miles: 1211, loads_without_miles: 0 },
      { unit: "800", delivered_loads: 0, empty_moves: 0, mcleod_miles: 0, loads_without_miles: 0 },
    ]);
    expect(out.not_found).toEqual(["999"]);
    expectOrgScoped(rec, ORG);
  });

  // F21 R4b. What a hand-built link would get wrong: the API's EXCLUSIVE instant end where the page
  // takes inclusive days, a unit number where the page takes a vehicle id, and a linked dispatcher's
  // default "mine" scope where the tool counted every dispatcher's loads.
  it("links to the Delivered tab on the answer's inclusive days, the whole fleet's scope, and one named truck by vehicle id", async () => {
    const one = (await assistantLoadsByTruck(recorder().client, ORG, { period: "last_month", units: ["751"] }, NOV_10)) as Out;
    expect(one.link).toEqual({
      surfaceKey: "dispatch.loads",
      query: { queue: "delivered", delivered_from: "2026-10-01", delivered_to: "2026-10-31", truck: "v751", scope: "all" },
    });
    expect(one.link.query).toEqual(loadsToQuery({ queue: "delivered", deliveredFrom: "2026-10-01", deliveredTo: "2026-10-31", vehicleId: "v751", scope: "all" }));
    // Two trucks: the page's Truck filter takes one id, so the link lists them all.
    const two = (await assistantLoadsByTruck(recorder().client, ORG, { period: "last_month", units: ["751", "800"] }, NOV_10)) as Out;
    expect(two.link.query).toEqual({ queue: "delivered", delivered_from: "2026-10-01", delivered_to: "2026-10-31", scope: "all" });
    const fleet = (await assistantLoadsByTruck(recorder().client, ORG, { period: "last_month" }, NOV_10)) as Out;
    expect(fleet.link.query).toEqual(two.link.query);
  });

  it("refuses an answer when no named unit is this fleet's, rather than answering the fleet", async () => {
    const out = (await assistantLoadsByTruck(recorder().client, ORG, { units: ["999"] }, NOV_10)) as Out;
    expect(out).toEqual({ error: "None of the named units are in this fleet.", not_found: ["999"] });
  });

  it("says where the delivery history begins when the window starts before it", async () => {
    const out = (await assistantLoadsByTruck(recorder().client, ORG, { from: "2026-03-01", to: "2026-04-30" }, NOV_10)) as Out;
    expect(out.history_note).toBe("The days before 2026-03-27 hold no loads in Silvicom; counts cover only the days after it.");
  });

  it("lists at most the limit, the most deliveries first, and says how many were left out", async () => {
    const out = (await assistantLoadsByTruck(recorder().client, ORG, { period: "last_month", limit: 1 }, NOV_10)) as Out;
    expect(out.trucks.map((t: Out) => t.unit)).toEqual(["748"]);
    expect(out.trucks_note).toBe("1 of 3 trucks listed, the most delivered loads first.");
  });
});
