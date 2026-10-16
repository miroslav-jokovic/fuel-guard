import { describe, expect, it } from "vitest";
import {
  buildDriverMatchIndex,
  matchMedstopPerson,
  poolPace,
  reconcileRosters,
  drawPeriodOf,
  randomDrawsThisYear,
  driversDueForRandomTest,
  type MatchedPerson,
  type MedstopPersonRow,
  type RosterDriverRow,
  type SelectionRow,
} from "./medstopProgram.js";

const driver = (id: string, over: Partial<RosterDriverRow> = {}): RosterDriverRow => ({
  id,
  fullName: `Driver ${id}`,
  firstName: "Pat",
  lastName: `Driver${id}`,
  birthDate: "1980-01-01",
  cdlNumber: `D${id}`,
  cdlState: "IL",
  status: "active",
  archived: false,
  ...over,
});

const person = (id: string, over: Partial<MedstopPersonRow> = {}): MedstopPersonRow => ({
  medstopId: `m-${id}`,
  roster: "active",
  firstName: "Pat",
  lastName: `Driver${id}`,
  birthDate: "1980-01-01",
  licenseNumber: `D${id}`,
  licenseState: "IL",
  medicalExpiresOn: null,
  ...over,
});

describe("matchMedstopPerson", () => {
  it("matches on licence + state first, ignoring punctuation Med-Stop keeps", () => {
    const idx = buildDriverMatchIndex([driver("1", { cdlNumber: "D123-4567" })]);
    expect(matchMedstopPerson(person("x", { licenseNumber: "d1234567", firstName: "Other" }), idx)).toEqual({
      driverId: "1",
      rule: "licence",
    });
  });

  it("does not match a licence number issued by a different state", () => {
    const idx = buildDriverMatchIndex([driver("1", { firstName: "A", lastName: "B" })]);
    expect(matchMedstopPerson(person("1", { licenseState: "WI", firstName: "C" }), idx)).toBeNull();
  });

  it("falls back to name + date of birth when our row has no licence (13 such drivers, §5A)", () => {
    const idx = buildDriverMatchIndex([driver("1", { cdlNumber: null })]);
    expect(matchMedstopPerson(person("1"), idx)).toEqual({ driverId: "1", rule: "name_dob" });
  });

  it("picks the one namesake whose birth date agrees", () => {
    const idx = buildDriverMatchIndex([
      driver("1", { cdlNumber: null, lastName: "Same", birthDate: "1970-05-05" }),
      driver("2", { cdlNumber: null, lastName: "Same", birthDate: "1980-01-01" }),
    ]);
    expect(matchMedstopPerson(person("x", { lastName: "Same", licenseNumber: null }), idx)).toEqual({
      driverId: "2",
      rule: "name_dob",
    });
  });

  it("refuses a name shared by two drivers when the birth date cannot separate them", () => {
    const idx = buildDriverMatchIndex([
      driver("1", { cdlNumber: null, lastName: "Same", birthDate: null }),
      driver("2", { cdlNumber: null, lastName: "Same", birthDate: null }),
    ]);
    expect(matchMedstopPerson(person("x", { lastName: "Same", licenseNumber: null }), idx)).toBeNull();
  });

  it("refuses a single namesake whose birth date disagrees — two people, one name", () => {
    const idx = buildDriverMatchIndex([driver("1", { cdlNumber: null, birthDate: "1990-02-02" })]);
    expect(matchMedstopPerson(person("1", { licenseNumber: null }), idx)).toBeNull();
  });

  it("matches a full_name-only row by its first and last word", () => {
    const idx = buildDriverMatchIndex([
      driver("1", { firstName: null, lastName: null, fullName: "Jose  Maria Pena", cdlNumber: null, birthDate: null }),
    ]);
    expect(matchMedstopPerson(person("x", { firstName: "José", lastName: "Peña", licenseNumber: null }), idx)?.rule).toBe(
      "name",
    );
  });
});

describe("poolPace", () => {
  const drugPool = {
    service: "TD",
    name: "2026 drug",
    poolYear: 2026,
    endsOn: "2026-12-31",
    frequency: "QUARTERLY",
    targetPercent: 53,
    currentPercent: 42.58,
    membersAvg: 155,
    completedTests: 66,
    scheduledTests: 17,
  };

  it("owes ⌈target × average⌉ − completed — the live pool's 17 on 10/13", () => {
    const p = poolPace(drugPool, []);
    expect(p.requiredTests).toBe(83);
    expect(p.testsOwed).toBe(17);
    expect(p.scheduledTests).toBe(17);
  });

  it("never owes a negative count once the target is passed", () => {
    expect(poolPace({ ...drugPool, completedTests: 90 }, []).testsOwed).toBe(0);
  });

  it("counts this year's cancelled and expired draws of the same service, not reserves or other years", () => {
    const s = (id: string, status: string, over: Partial<SelectionRow> = {}): SelectionRow => ({
      medstopId: id,
      poolMedstopId: "p",
      employeeMedstopId: "e",
      service: "TD",
      selectedOn: "2026-03-01",
      requestMedstopId: null,
      testMedstopId: null,
      status,
      ...over,
    });
    const lost = poolPace(drugPool, [
      s("1", "CANCELED"),
      s("2", "EXPIRED"),
      s("3", "EXPIRED RESERVE"),
      s("4", "CANCELED", { selectedOn: "2025-11-01" }),
      s("5", "CANCELED", { service: "TA" }),
      s("6", "COMPLETED", { testMedstopId: "t" }),
    ]).lostSelections;
    expect(lost).toBe(2);
  });
});

describe("randomDrawsThisYear", () => {
  const POOL = { medstopId: "p26", startsOn: "2026-01-01T00:00:00", endsOn: "2026-12-31T23:59:00", frequency: "QUARTERLY" };
  const POOL25 = { medstopId: "p25", startsOn: "2025-01-01T00:00:00", endsOn: "2025-12-31T23:59:00", frequency: "QUARTERLY" };
  const pools = [POOL, POOL25];
  const sel = (id: string, day: string, over: Partial<SelectionRow> = {}): SelectionRow => ({
    medstopId: id,
    poolMedstopId: day.startsWith("2025") ? "p25" : "p26",
    employeeMedstopId: `e${id}`,
    service: "TD",
    selectedOn: `${day}T17:00:00`,
    requestMedstopId: null,
    testMedstopId: null,
    status: "OPEN",
    ...over,
  });
  const who = (id: string | null) => ({ driverId: null, medstopId: id, name: id ?? "?" });
  const states = (draws: { selectionId: string; state: string }[]) => draws.map((d) => [d.selectionId, d.state]);

  it("calls every OPEN draw of the current quarter due — the office's paper list — whatever day Med-Stop dated it inside the quarter (D-MSUX19)", () => {
    const { draws, currentPeriod } = randomDrawsThisYear(
      [
        sel("a", "2026-10-08"), sel("b", "2026-10-06"), sel("t", "2026-10-15"),
        sel("f1", "2026-11-08"), sel("f2", "2026-12-20"),
        sel("x1", "2026-03-01", { status: "COMPLETED", testMedstopId: "t1" }),
        sel("x2", "2026-09-01", { status: "COMPLETED", testMedstopId: "t2" }),
        sel("old", "2025-12-30", { status: "COMPLETED", testMedstopId: "t0" }),
        sel("late", "2025-12-29"),
      ],
      pools,
      who,
      "2026-10-15",
    );
    expect(currentPeriod).toEqual({ startsOn: "2026-10-01", endsOn: "2026-12-31", months: 3 });
    expect(draws.map((d) => [d.selectionId, d.state, d.period, d.daysSince])).toEqual([
      ["late", "due", "earlier", 290], ["b", "due", "current", 9], ["a", "due", "current", 7], ["t", "due", "current", 0],
      ["f1", "due", "current", -24], ["f2", "due", "current", -66],
      ["x2", "tested", "earlier", 44], ["x1", "tested", "earlier", 228],
    ]);
  });

  it("keeps a draw in a LATER quarter upcoming, and an earlier quarter's open draw due", () => {
    const { draws } = randomDrawsThisYear([sel("q3", "2026-09-29"), sel("q4", "2026-10-02")], pools, who, "2026-09-30");
    expect(draws.map((d) => [d.selectionId, d.state, d.period])).toEqual([["q3", "due", "current"], ["q4", "upcoming", "later"]]);
  });

  it("derives the period from the pool's own start and frequency, never the calendar", () => {
    expect(drawPeriodOf({ medstopId: "m", startsOn: "2026-02-15", endsOn: "2027-02-14", frequency: "QUARTERLY" }, "2026-05-15"))
      .toEqual({ startsOn: "2026-05-15", endsOn: "2026-08-14", months: 3 });
    expect(drawPeriodOf({ medstopId: "m", startsOn: "2026-01-01", endsOn: "2026-12-31", frequency: "MONTHLY" }, "2026-10-15"))
      .toEqual({ startsOn: "2026-10-01", endsOn: "2026-10-31", months: 1 });
    // An unknown word makes the whole pool the period: more listed as due, nothing hidden.
    expect(drawPeriodOf({ medstopId: "m", startsOn: "2026-01-01", endsOn: "2026-12-31", frequency: "BIWEEKLY" }, "2026-10-15"))
      .toEqual({ startsOn: "2026-01-01", endsOn: "2026-12-31", months: null });
    expect(drawPeriodOf(POOL, "2027-01-01")).toBeNull();
  });

  it("has no current period between pool years, and falls back to the date for a selection whose pool we do not hold", () => {
    const { draws, currentPeriod } = randomDrawsThisYear(
      [sel("n", "2026-10-20", { poolMedstopId: null }), sel("p", "2026-10-01", { poolMedstopId: "gone" })],
      [POOL25],
      who,
      "2026-10-15",
    );
    expect(currentPeriod).toBeNull();
    expect(draws.map((d) => [d.selectionId, d.state, d.period])).toEqual([["p", "due", "earlier"], ["n", "upcoming", "later"]]);
  });

  it("names every way a draw ends — and a test settles it whatever Med-Stop's word", () => {
    const { draws } = randomDrawsThisYear(
      [
        sel("r", "2026-12-27", { status: "RESERVE" }),
        sel("re", "2026-09-29", { status: "EXPIRED RESERVE" }),
        sel("k", "2026-09-28", { status: "CANCELED" }),
        sel("e", "2026-09-27", { status: "EXPIRED" }),
        sel("rf", "2026-09-26", { status: "REFUSAL", testMedstopId: "t" }),
        sel("q", "2026-09-25", { status: "SOMETHING NEW" }),
      ],
      pools,
      who,
      "2026-10-13",
    );
    expect(states(draws)).toEqual([
      ["r", "alternate"], ["re", "alternate_unused"], ["k", "cancelled"], ["e", "expired"], ["rf", "tested"], ["q", "other"],
    ]);
    expect(draws.find((d) => d.selectionId === "q")?.medstopStatus).toBe("SOMETHING NEW");
  });

  it("sends to collection every driver the Random tab lists as due — ordered or not — and nobody drawn for a later quarter, tested, or unmatched", () => {
    const driverOf = (id: string | null) => (id === "eunmatched" ? null : id ? `drv-${id}` : null);
    const due = driversDueForRandomTest(
      [
        sel("now", "2026-09-06"),
        sel("ordered", "2026-09-08", { requestMedstopId: "req" }),
        sel("last-q", "2026-06-29"),
        sel("next-q", "2026-10-02"),
        sel("tested", "2026-09-02", { status: "COMPLETED", testMedstopId: "t" }),
        sel("cancelled", "2026-09-03", { status: "CANCELED" }),
        sel("unmatched", "2026-09-04"),
      ],
      pools,
      driverOf,
      "2026-09-30",
    );
    expect([...due].sort()).toEqual(["drv-elast-q", "drv-enow", "drv-eordered"]);
  });

  it("marks a draw whose request is placed as ordered", () => {
    const { draws } = randomDrawsThisYear([sel("a", "2026-10-10", { requestMedstopId: "req" }), sel("b", "2026-10-10")], pools, who, "2026-10-13");
    expect(draws.map((d) => [d.selectionId, d.ordered])).toEqual([["a", true], ["b", false]]);
  });
});

describe("reconcileRosters", () => {
  const drivers = [
    driver("1"),
    driver("2"),
    driver("3", { status: "terminated" }),
    driver("4", { archived: true }),
    driver("5", { cdlNumber: null }),
  ];
  const people: MatchedPerson[] = [
    { ...person("1"), driverId: "1" },
    { ...person("3"), driverId: "3" },
    { ...person("4"), driverId: "4" },
    { ...person("5"), driverId: "5", medicalExpiresOn: "2027-07-22T00:00:00" },
    { ...person("9", { firstName: "Nobody" }), driverId: null },
    { ...person("6", { roster: "terminated" }), driverId: "2" },
  ];
  const out = reconcileRosters(people, drivers);

  it("lists an active driver with no ACTIVE Med-Stop record as outside the pool — a terminated record does not count", () => {
    expect(out.notInPool.map((p) => p.driverId)).toEqual(["2"]);
  });

  it("lists Med-Stop actives we terminated or archived, plus unmatched Med-Stop actives for a person to settle", () => {
    expect(out.leftButInPool.map((p) => p.driverId ?? p.medstopId).sort()).toEqual(["3", "4", "m-9"]);
  });

  it("answers only the two violation lists — no licence chore, no medical list", () => {
    expect(Object.keys(out).sort()).toEqual(["leftButInPool", "notInPool"]);
  });
});
