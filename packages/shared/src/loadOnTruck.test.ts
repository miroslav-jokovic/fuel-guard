import { describe, expect, it } from "vitest";
import {
  ON_TRUCK_CANDIDATE_STATUSES,
  WITH_DRIVER_CANDIDATE_STATUSES,
  LOAD_STATUSES,
  compareLoadsOnTruck,
  isLoadOnTruck,
  isLoadWithDriver,
  isStopBehindTruck,
  mcleodStopDeparted,
  nextStopOnRoute,
  nextStop,
  projectMcleodStatus,
} from "./index.js";

/**
 * "What is this truck / this driver hauling right now" — the live map and the Assignments board
 * (2026-09-28). The McLeod half is D-MCC12, "draw only `P`": `P` projects to `approved` (nothing
 * departed) or `in_transit`, and a McLeod load never reaches `accepted`, which is what both surfaces
 * asked for before and why neither would have shown a McLeod load McLeod had planned onto a truck.
 */
describe("isLoadOnTruck", () => {
  const tms = (status: string) => isLoadOnTruck({ status, source: "tms" });
  const manual = (status: string) => isLoadOnTruck({ status, source: "manual" });

  it("draws a McLeod load exactly when McLeod has it P, whether or not a stop is departed yet", () => {
    expect(LOAD_STATUSES.filter(tms)).toEqual(["approved", "in_transit"]);
    // The link to the projection, so the two cannot drift: P with nothing departed and P under way.
    expect(tms(projectMcleodStatus("P", ["A", "A"])!)).toBe(true);
    expect(tms(projectMcleodStatus("P", ["D", "A"])!)).toBe(true);
    // A is the planning queue, never drawn — even with a driver and truck on it (the board calls
    // that "Planned", the map does not draw it: McLeod has not dispatched it).
    expect(tms(projectMcleodStatus("A", [])!)).toBe(false);
    expect(tms(projectMcleodStatus("D", ["D"])!)).toBe(false);
    expect(tms(projectMcleodStatus("V", [])!)).toBe(false);
  });

  it("keeps the old rule for a load that did not come from McLeod: approved there is not on a truck", () => {
    expect(LOAD_STATUSES.filter(manual)).toEqual(["accepted", "in_transit"]);
    expect(isLoadOnTruck({ status: "approved", source: null })).toBe(false);
  });

  it("asks the database for no status either rule can never accept, and for every one they can", () => {
    const either = LOAD_STATUSES.filter((s) => tms(s) || manual(s));
    expect([...ON_TRUCK_CANDIDATE_STATUSES].sort()).toEqual([...either].sort());
  });
});

describe("isLoadWithDriver", () => {
  it("is the truck's load, plus a non-McLeod load offered to the driver in the app", () => {
    expect(isLoadWithDriver({ status: "approved", source: "tms" })).toBe(true);
    expect(isLoadWithDriver({ status: "offered", source: "manual" })).toBe(true);
    expect(isLoadWithDriver({ status: "offered", source: "tms" })).toBe(false);
    expect(isLoadWithDriver({ status: "approved", source: "manual" })).toBe(false);
    expect(isLoadWithDriver({ status: "pending_approval", source: "tms" })).toBe(false);
  });

  it("asks the database for exactly the statuses some source can accept", () => {
    const either = LOAD_STATUSES.filter((s) => isLoadWithDriver({ status: s, source: "tms" }) || isLoadWithDriver({ status: s, source: "manual" }));
    expect([...WITH_DRIVER_CANDIDATE_STATUSES].sort()).toEqual([...either].sort());
  });
});

describe("mcleodStopDeparted", () => {
  it("is McLeod's D, trimmed (char columns arrive padded), and nothing else", () => {
    expect(mcleodStopDeparted("D")).toBe(true);
    expect(mcleodStopDeparted("D ")).toBe(true);
    expect(mcleodStopDeparted("A")).toBe(false);
    expect(mcleodStopDeparted(null)).toBe(false);
    expect(mcleodStopDeparted(undefined)).toBe(false);
  });
});

describe("nextStopOnRoute — where the truck goes next, by any source's evidence", () => {
  const stop = (seq: number, status: string, external_status: string | null = null) => ({ id: `s${seq}`, seq, status, external_status });

  it("skips a stop McLeod has departed even though the driver app never touched it", () => {
    // The live board on 2026-09-28: every P had its pickup departed in McLeod and `pending` here.
    const stops = [stop(1, "pending", "D"), stop(2, "pending", "A")];
    expect(nextStopOnRoute(stops)?.id).toBe("s2");
  });

  it("keeps a stop the truck has arrived at but not left: that IS where it is going", () => {
    expect(nextStopOnRoute([stop(1, "pending", "D"), stop(2, "arrived", "A"), stop(3, "pending", "A")])?.id).toBe("s2");
  });

  it("still honours the driver app's own finish on a load McLeod never sent", () => {
    expect(nextStopOnRoute([stop(1, "completed"), stop(2, "skipped"), stop(3, "pending")])?.id).toBe("s3");
  });

  it("orders by sequence, never by the order the rows arrived in", () => {
    expect(nextStopOnRoute([stop(3, "pending", "A"), stop(2, "pending", "A"), stop(1, "pending", "D")])?.id).toBe("s2");
  });

  it("is null when every stop is behind the truck, or there are none", () => {
    expect(nextStopOnRoute([stop(1, "pending", "D"), stop(2, "completed", "A")])).toBeNull();
    expect(nextStopOnRoute([])).toBeNull();
  });

  it("is a separate reading from the driver's nextStop, which McLeod's departure does not move (Q-LMR2)", () => {
    const load = { stops: [{ ...stop(1, "pending", "D"), kind: "pickup" }, { ...stop(2, "pending", "A"), kind: "dropoff" }] };
    expect(isStopBehindTruck(load.stops[0]!)).toBe(true);
    expect(nextStop(load as never)?.id).toBe("s1");
  });
});

describe("compareLoadsOnTruck — one load per truck or driver, never by row order", () => {
  const l = (id: string, ref: string | null, status: string) => ({ id, ref, status });
  const pick = (rows: ReturnType<typeof l>[]) => [...rows].sort(compareLoadsOnTruck)[0]!.id;

  it("shows the load under way over one planned or taken, whichever order the rows came in", () => {
    const current = l("a", "0009", "in_transit");
    const next = l("b", "0001", "approved");
    expect(pick([current, next])).toBe("a");
    expect(pick([next, current])).toBe("a");
    expect(pick([l("c", "1", "offered"), l("d", "2", "accepted")])).toBe("d");
  });

  it("breaks a tie on the smaller reference, then the id, the same way every read", () => {
    expect(pick([l("z", "0002", "in_transit"), l("y", "0001", "in_transit")])).toBe("y");
    expect(pick([l("b", null, "approved"), l("a", null, "approved")])).toBe("a");
  });
});
