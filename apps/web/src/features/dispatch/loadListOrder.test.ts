import { describe, expect, it } from "vitest";
import { sortRows } from "@silvicom/ui";
import { OPENING_SORT, listSort, loadEventAt, loadStartedAt } from "./loadListOrder";
import type { DispatchLoad, DispatchStop } from "./useDispatchLoads";

/**
 * DISPATCH-LOADS-COUNTS-PLAN D-DLC4 / Q-DLC7: every loads table opens by the row's own event time —
 * the mirror's insertion order is not one.
 */
const stop = (seq: number, kind: DispatchStop["kind"], appt: string, left: string | null = null): DispatchStop =>
  ({ seq, kind, name: `${kind} ${seq}`, appointment_start: appt, appointment_end: null, required_photos: [], actual_departure_at: left }) as DispatchStop;
const load = (id: string, status: DispatchLoad["status"], stops: DispatchStop[], created: string): DispatchLoad =>
  ({ id, ref: id, status, source: "tms", stops, created_at: created }) as unknown as DispatchLoad;

// Created in the order c1 < c2 < c3 — the server's order, which no tab opens in any more.
const inTransitOld = load("T-old", "in_transit", [stop(1, "pickup", "2026-10-01T08:00:00Z", "2026-10-01T09:00:00Z"), stop(2, "dropoff", "2026-10-03T08:00:00Z")], "c3");
const inTransitNew = load("T-new", "in_transit", [stop(1, "pickup", "2026-10-10T08:00:00Z", "2026-10-10T09:30:00Z"), stop(2, "dropoff", "2026-10-12T08:00:00Z")], "c1");
const inTransitUnkeyed = load("T-unkeyed", "in_transit", [stop(1, "pickup", "2026-10-11T08:00:00Z"), stop(2, "dropoff", "2026-10-13T08:00:00Z")], "c2");
const upcomingSoon = load("U-soon", "approved", [stop(1, "pickup", "2026-10-21T08:00:00Z"), stop(2, "dropoff", "2026-10-22T08:00:00Z")], "c3");
const upcomingLater = load("U-later", "approved", [stop(1, "pickup", "2026-10-25T08:00:00Z"), stop(2, "dropoff", "2026-10-26T08:00:00Z")], "c1");
const deliveredOld = load("D-old", "delivered", [stop(1, "pickup", "2026-10-02T08:00:00Z", "2026-10-02T09:00:00Z"), stop(2, "dropoff", "2026-10-04T08:00:00Z", "2026-10-04T10:00:00Z")], "c1");
const deliveredNew = load("D-new", "delivered", [stop(1, "pickup", "2026-10-05T08:00:00Z", "2026-10-05T09:00:00Z"), stop(2, "dropoff", "2026-10-14T08:00:00Z", "2026-10-14T10:00:00Z")], "c2");

const value = (l: DispatchLoad, key: string): unknown => {
  if (key === "started") return loadStartedAt(l);
  if (key === "event") return loadEventAt(l);
  if (key === "pickup") return l.stops.find((s) => s.kind === "pickup")?.appointment_start ?? null;
  if (key === "delivered") return l.status === "delivered" ? loadEventAt(l) : null;
  return null;
};
const ids = (rows: DispatchLoad[], tab: keyof typeof OPENING_SORT) => sortRows(rows, OPENING_SORT[tab], value).map((l) => l.id);

describe("the order each Loads tab opens in", () => {
  it("In transit: the load that left its pickup most recently first, one McLeod has not keyed last", () => {
    expect(ids([inTransitOld, inTransitUnkeyed, inTransitNew], "in_transit")).toEqual(["T-new", "T-old", "T-unkeyed"]);
  });

  it("Upcoming and Uncovered: the nearest pickup appointment first (Q-DLC7)", () => {
    expect(ids([upcomingLater, upcomingSoon], "upcoming")).toEqual(["U-soon", "U-later"]);
    expect(ids([upcomingLater, upcomingSoon], "uncovered")).toEqual(["U-soon", "U-later"]);
  });

  it("Delivered: the newest delivery first", () => {
    expect(ids([deliveredOld, deliveredNew], "delivered")).toEqual(["D-new", "D-old"]);
  });

  it("All: every row by its own defining moment, latest first — delivery, else departure, else appointment", () => {
    expect(ids([deliveredOld, inTransitOld, upcomingSoon, deliveredNew, inTransitNew, inTransitUnkeyed, upcomingLater], "all")).toEqual([
      "U-later", // appointment 10/25
      "U-soon", // appointment 10/21
      "D-new", // delivered 10/14
      "T-unkeyed", // appointment 10/11, departure not keyed
      "T-new", // left 10/10
      "D-old", // delivered 10/04
      "T-old", // left 10/01
    ]);
  });

  it("a header click overrides the opening order; Exceptions is not a loads table", () => {
    expect(listSort({ key: null, dir: "asc" }, "in_transit")).toEqual({ key: "started", dir: "desc" });
    expect(listSort({ key: "ref", dir: "asc" }, "in_transit")).toEqual({ key: "ref", dir: "asc" });
    expect(listSort({ key: null, dir: "asc" }, "exceptions")).toEqual({ key: null, dir: "asc" });
  });

  it("the created order the server returns is not any tab's opening order", () => {
    const byCreated = [inTransitNew, inTransitUnkeyed, inTransitOld].map((l) => l.id); // c1, c2, c3
    expect(ids([inTransitNew, inTransitUnkeyed, inTransitOld], "in_transit")).not.toEqual(byCreated);
  });
});
