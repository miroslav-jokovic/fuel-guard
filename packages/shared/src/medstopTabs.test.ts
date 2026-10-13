import { describe, expect, it } from "vitest";
import { inProgressRows, medicalCardsDue, type InProgressOrder, type InProgressTest } from "./medstopTabs.js";

const TODAY = "2026-10-13";
const who = (id: string | null) => ({ driverId: null, medstopId: id, name: `P ${id}` });

describe("inProgressRows", () => {
  const order = (id: string, over: Partial<InProgressOrder> = {}): InProgressOrder => ({
    medstopId: id, employeeMedstopId: `e${id}`, service: "TD", reason: "PRE-EMPLOYMENT", status: "OPEN",
    requestedLocal: "2026-10-12T16:00:00", testMedstopId: null, ...over,
  });
  const test = (id: string, over: Partial<InProgressTest> = {}): InProgressTest => ({
    medstopId: id, employeeMedstopId: `e${id}`, service: "TD", reason: "PRE-EMPLOYMENT", status: "AT LAB",
    result: null, collectedLocal: "2026-10-06T09:00:00", ...over,
  });

  it("lists open orders and unfinished tests, longest-waiting first, with stage and expected-by", () => {
    const rows = inProgressRows([order("o1")], [test("t1"), test("t2", { status: "COMPLETED", collectedLocal: "2026-10-12T13:00:00" })], who, TODAY, true);
    expect(rows.map((r) => [r.key, r.stage, r.daysWaiting])).toEqual([
      ["test:t1", "At the lab", 7],
      ["order:o1", "Ordered, not collected", 1],
      ["test:t2", "Collected", 1],
    ]);
    expect(rows[0]!.expectedOn).toBe("2026-10-10");
  });

  it("leaves out what is done: a collected order (its test is the row), a final result, a closed test", () => {
    const rows = inProgressRows(
      [order("o1", { testMedstopId: "t9" }), order("o2", { status: "COMPLETED" }), order("o3", { status: "CANCELED" })],
      [test("a", { status: "CLOSED", result: "NEGATIVE" }), test("b", { status: "CLOSED", result: null }), test("c", { service: "TA", status: "COMPLETED", result: "NEGATIVE" })],
      who, TODAY, true,
    );
    expect(rows).toEqual([]);
  });

  it("hides a RANDOM order or test from a reader who may not read testing records (§382.305(l))", () => {
    const orders = [order("o1", { reason: "RANDOM" })];
    const tests = [test("t1", { reason: "RANDOM" }), test("t2")];
    expect(inProgressRows(orders, tests, who, TODAY, false).map((r) => r.key)).toEqual(["test:t2"]);
    expect(inProgressRows(orders, tests, who, TODAY, true)).toHaveLength(3);
  });
});

describe("medicalCardsDue", () => {
  const drivers = [
    { id: "a", fullName: "Ann", working: true },
    { id: "b", fullName: "Bob", working: true },
    { id: "c", fullName: "Cy", working: true },
    { id: "d", fullName: "Dee", working: false },
    { id: "e", fullName: "Eve", working: true },
  ];
  const ours = new Map([["a", "2026-11-01"], ["b", "2027-06-01"], ["c", "2026-10-01"], ["d", "2026-10-20"], ["e", null]]);
  const medstop = new Map([["a", "2026-11-01"], ["b", "2026-11-30"], ["e", "2026-12-01"]]);
  const rows = medicalCardsDue(drivers, ours, medstop, TODAY);

  it("lists working drivers due within 60 days or expired by either source, soonest first", () => {
    expect(rows.map((r) => [r.person.driverId, r.expiresOn, r.daysLeft])).toEqual([
      ["c", "2026-10-01", -12],
      ["a", "2026-11-01", 19],
      ["b", "2026-11-30", 48],
      ["e", "2026-12-01", 49],
    ]);
  });

  it("shows Med-Stop's date only when it differs from ours, and takes the earlier (safe side)", () => {
    expect(rows.find((r) => r.person.driverId === "a")).toMatchObject({ ours: "2026-11-01", medstop: null });
    expect(rows.find((r) => r.person.driverId === "b")).toMatchObject({ ours: "2027-06-01", medstop: "2026-11-30", expiresOn: "2026-11-30" });
    expect(rows.find((r) => r.person.driverId === "e")).toMatchObject({ ours: null, medstop: "2026-12-01" });
  });

  it("never lists a driver who is not working", () => {
    expect(rows.some((r) => r.person.driverId === "d")).toBe(false);
  });
});
