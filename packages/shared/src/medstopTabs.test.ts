import { describe, expect, it } from "vitest";
import { inProgressRows, medicalCards, type InProgressOrder, type InProgressTest } from "./medstopTabs.js";
import type { MedicalCardState } from "./credentialSources.js";

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

describe("medicalCards", () => {
  const drivers = [
    { id: "a", fullName: "Ann", working: true },
    { id: "b", fullName: "Bob", working: true },
    { id: "c", fullName: "Cy", working: true },
    { id: "d", fullName: "Dee", working: false },
    { id: "e", fullName: "Eve", working: true },
    { id: "f", fullName: "Fay", working: true },
  ];
  const card = (expiresOn: string | null, documented = false) => ({ expiresOn, documented });
  const mcleod = (d: string) => ({ source: "mcleod" as const, expiresOn: d });
  const medstop = (d: string) => ({ source: "medstop" as const, expiresOn: d });
  const states = new Map<string, MedicalCardState>([
    ["a", { onFile: card("2026-11-01"), claims: [mcleod("2026-11-01"), medstop("2026-11-01")] }],
    // Unscanned, sources disagree: the earliest is what the file will hold.
    ["b", { onFile: card("2027-06-01"), claims: [medstop("2026-11-30"), mcleod("2027-06-01")] }],
    ["c", { onFile: card("2026-10-01"), claims: [mcleod("2026-10-01")] }],
    ["d", { onFile: card("2026-10-20"), claims: [mcleod("2026-10-20")] }],
    // No card yet, Med-Stop alone has a date.
    ["e", { onFile: null, claims: [medstop("2026-12-01")] }],
    // Scanned card, far out; McLeod disagrees — not due, but flagged.
    ["f", { onFile: card("2027-09-01", true), claims: [mcleod("2026-12-20")] }],
  ]);
  const { due, disagree } = medicalCards(drivers, states, TODAY);

  it("lists working drivers due within 60 days or expired, by the date the rule files, soonest first", () => {
    expect(due.map((r) => [r.person.driverId, r.expiresOn, r.daysLeft])).toEqual([
      ["c", "2026-10-01", -12],
      ["a", "2026-11-01", 19],
      ["b", "2026-11-30", 48],
      ["e", "2026-12-01", 49],
    ]);
  });

  it("flags every working driver whose sources disagree, whether due or not, with each source's date", () => {
    expect(disagree.map((r) => r.person.driverId)).toEqual(["b", "f"]);
    expect(disagree[0]!.sources).toEqual([mcleod("2027-06-01"), medstop("2026-11-30")]);
    expect(disagree[1]).toMatchObject({ expiresOn: "2027-09-01", documented: true });
  });

  it("never lists a driver who is not working", () => {
    expect([...due, ...disagree].some((r) => r.person.driverId === "d")).toBe(false);
  });
});
