import { describe, expect, it } from "vitest";
import {
  assignmentsOf,
  readAttribution,
  candidateIntervals,
  confidenceOf,
  fixesOf,
  readDriver,
  resolveInstant,
  stateOfAddress,
  type Assignment,
  type GpsFix,
} from "./reading.js";

/**
 * IC5's reading, against the stop it was measured on: unit 698 at the Erwinville scale (US 190, LA) on
 * 2026-09-22, report 13:04–13:27. Samsara's GPS (sampled from the real answer) has the truck at highway
 * speed until 18:03Z, at 0.0 mph from 18:04Z to 18:42Z, and moving again at 18:43Z; its HOS assignments
 * put GREGORY GRIGGS on the truck until 18:04:10Z and again from 18:42:49Z.
 */

const t = (hhmmss: string, day = "2026-09-22") => Date.parse(`${day}T${hhmmss}Z`);
const fix = (hhmmss: string, mph: number, state: string | null = "LA"): GpsFix => ({ ms: t(hhmmss), mph, state });
const ERWINVILLE: GpsFix[] = [
  fix("16:58:00", 64), fix("17:05:00", 61), fix("17:20:00", 66), fix("17:30:00", 58), // the hour before: driving
  fix("17:55:00", 59.6), fix("18:02:37", 55.3), fix("18:03:11", 34.8),
  fix("18:04:04", 0), fix("18:09:36", 0), fix("18:11:27", 0), fix("18:24:08", 0), fix("18:40:10", 0), fix("18:42:21", 0),
  fix("18:43:16", 18), fix("18:44:52", 58.4), fix("19:05:00", 63), fix("19:20:00", 60), // the hour after: driving
];
const griggs = (start: string, end: string, o: Partial<Assignment> = {}): Assignment => ({
  driverId: "53867066", driverName: "GREGORY GRIGGS", passenger: false, startMs: t(start), endMs: t(end), ...o,
});
const ERWINVILLE_ASSIGNMENTS = [griggs("14:30:21", "18:04:10"), griggs("18:42:49", "18:58:51"), griggs("19:09:55", "19:11:19")];

describe("the report's local time, one interval per zone its state could be on (D-IC8)", () => {
  it("puts a Louisiana report on Central daylight time", () => {
    expect(candidateIntervals("2026-09-22", "1304", "1327", "LA")).toEqual([
      { zone: "America/Chicago", startMs: t("18:04:00"), endMs: t("18:27:00") },
    ]);
  });

  it("gives a split state both its zones, and Central standard time in winter", () => {
    expect(candidateIntervals("2026-01-15", "0900", "0930", "TX").map((c) => [c.zone, new Date(c.startMs).toISOString()])).toEqual([
      ["America/Chicago", "2026-01-15T15:00:00.000Z"],
      ["America/Denver", "2026-01-15T16:00:00.000Z"],
    ]);
  });

  it("carries an inspection across midnight, takes a missing end as the start, and refuses a report with no time", () => {
    const [late] = candidateIntervals("2026-09-22", "2350", "0015", "LA");
    expect((late!.endMs - late!.startMs) / 60_000).toBe(25);
    const [noEnd] = candidateIntervals("2026-09-22", "1304", null, "LA");
    expect(noEnd!.endMs).toBe(noEnd!.startMs);
    expect(candidateIntervals("2026-09-22", null, "1327", "LA")).toEqual([]);
    expect(candidateIntervals(null, "1304", "1327", "LA")).toEqual([]);
    expect(candidateIntervals("2026-09-22", "2575", "1327", "LA")).toEqual([]);
  });

  it("gives a federal report every mainland zone", () => {
    expect(candidateIntervals("2026-09-22", "1304", "1327", "US")).toHaveLength(5);
  });
});

describe("the state at the end of Samsara's address", () => {
  it.each([
    ["US 190;LA 1, LA, 70767", "LA"],
    ["LA, 70729", "LA"],
    ["Airline Highway, Pointe Coupee Parish, LA", "LA"],
    ["100 North Kings Highway, Fort Pierce, FL, 34945", "FL"],
    ["I-10, Exit 2, TX, 79835-1234", "TX"],
    ["Somewhere without a state", null],
    [undefined, null],
  ])("%s → %s", (address, state) => expect(stateOfAddress(address)).toBe(state));
});

describe("the instant: the candidate in which the truck stood still (D-IC8)", () => {
  it("confirms the Erwinville stop in Louisiana from the GPS", () => {
    const r = resolveInstant(candidateIntervals("2026-09-22", "1304", "1327", "LA"), ERWINVILLE, "LA");
    expect(r).toEqual({ zoneMethod: "gps", locationCheck: "confirmed", instant: { zone: "America/Chicago", startMs: t("18:04:00"), endMs: t("18:27:00") } });
  });

  it("chooses between a split state's zones by where the truck was stopped", () => {
    // The same stop written as if it were a Texas report: Central fits, Mountain (an hour later) is at highway speed.
    const r = resolveInstant(candidateIntervals("2026-09-22", "1304", "1327", "TX"), ERWINVILLE, "TX");
    expect([r.zoneMethod, r.instant?.zone, r.locationCheck]).toEqual(["gps", "America/Chicago", "other_state"]);
  });

  it("leaves the zone unresolved when the truck stood still in both, rather than guess", () => {
    const parked = [fix("16:00:00", 0, "TX"), fix("17:00:00", 0, "TX"), fix("18:00:00", 0, "TX"), fix("19:00:00", 0, "TX"), fix("20:00:00", 0, "TX")];
    const r = resolveInstant(candidateIntervals("2026-09-22", "1304", "1327", "TX"), parked, "TX");
    expect(r).toEqual({ zoneMethod: "unresolved", locationCheck: "confirmed", instant: null });
  });

  it("keeps a one-zone state's interval when the GPS is silent or says the truck was moving, and says which", () => {
    const la = candidateIntervals("2026-09-22", "1304", "1327", "LA");
    expect(resolveInstant(la, [], "LA")).toMatchObject({ zoneMethod: "state_only", locationCheck: "no_gps", instant: la[0] });
    expect(resolveInstant(la, [fix("18:00:00", 60), fix("18:15:00", 62), fix("18:25:00", 61)], "LA")).toMatchObject({ zoneMethod: "state_only", locationCheck: "moving" });
  });

  it("holds a stopped truck's last fix for half an hour, and no longer", () => {
    const la = candidateIntervals("2026-09-22", "1304", "1327", "LA");
    expect(resolveInstant(la, [fix("18:00:00", 0)], "LA").locationCheck).toBe("confirmed");
    expect(resolveInstant(la, [fix("17:30:00", 0)], "LA").locationCheck).toBe("no_gps");
  });

  it("calls the truck stopped when it stood still for at least half the inspection — it often leaves before the officer's end time", () => {
    const la = candidateIntervals("2026-09-22", "1304", "1327", "LA"); // settled: 18:09–18:27, 18 minutes
    const leftEarly = [fix("18:03:00", 0), fix("18:19:00", 45)]; // stopped 10 of 18 minutes
    expect(resolveInstant(la, leftEarly, "LA").locationCheck).toBe("confirmed");
    const shortStop = [fix("18:00:00", 55), fix("18:15:00", 0), fix("18:20:00", 50)]; // stopped 5 of 18
    expect(resolveInstant(la, shortStop, "LA").locationCheck).toBe("moving");
    const repositioned = [fix("18:04:00", 0), fix("18:15:00", 6), fix("18:16:00", 0)]; // one minute at walking pace
    expect(resolveInstant(la, repositioned, "LA").locationCheck).toBe("confirmed");
  });

  it("does not let the minutes the truck is still rolling in count as moving", () => {
    const la = candidateIntervals("2026-09-22", "1304", "1327", "LA");
    expect(resolveInstant(la, [fix("18:04:30", 12), fix("18:06:00", 0), fix("18:20:00", 0)], "LA").locationCheck).toBe("confirmed");
  });

  it("calls a stop in a fix with no state unplaced, and any state confirmed on a federal report", () => {
    const la = candidateIntervals("2026-09-22", "1304", "1327", "LA");
    expect(resolveInstant(la, [fix("18:10:00", 0, null)], "LA").locationCheck).toBe("unplaced");
    const us = candidateIntervals("2026-09-22", "1304", "1327", "US");
    expect(resolveInstant(us, ERWINVILLE, "US")).toMatchObject({ zoneMethod: "gps", locationCheck: "confirmed", instant: { zone: "America/Chicago" } });
  });
});

describe("the driver: Samsara's assignments within two hours (D-IC7)", () => {
  const at = { startMs: t("18:04:00"), endMs: t("18:27:00") };

  it("reads the Erwinville driver as bracketing the stop — Samsara closed his assignment while the truck stood at the scale", () => {
    const r = readDriver(ERWINVILLE_ASSIGNMENTS, at);
    expect(r).toMatchObject({ outcome: "one_driver", driver: { samsaraDriverId: "53867066", name: "GREGORY GRIGGS" }, basis: "bracketing" });
    expect(r.candidates[0]!.segments).toHaveLength(3);
  });

  it("reads an assignment that runs into the inspection as covering, but not one the officer's rounding grazes", () => {
    expect(readDriver([griggs("14:30:00", "18:15:00")], at).basis).toBe("covering");
    expect(readDriver([griggs("18:20:00", "19:00:00")], at).basis).toBe("covering");
    expect(readDriver([griggs("14:30:00", "18:08:00")], at).basis).toBe("before_only");
  });

  it("says before only or after only when the driver is on one side", () => {
    expect(readDriver([griggs("15:00:00", "17:30:00")], at).basis).toBe("before_only");
    expect(readDriver([griggs("19:00:00", "20:00:00")], at).basis).toBe("after_only");
  });

  it("names nobody for two drivers, a team, or none — those go to a person", () => {
    const other = griggs("19:00:00", "20:00:00", { driverId: "9", driverName: "OTHER" });
    expect(readDriver([griggs("15:00:00", "18:00:00"), other], at)).toMatchObject({ outcome: "several_drivers", driver: null, basis: null });
    expect(readDriver([griggs("15:00:00", "19:00:00", { passenger: true })], at).outcome).toBe("several_drivers");
    expect(readDriver([], at)).toMatchObject({ outcome: "no_assignment", candidates: [] });
  });

  it("ignores an assignment that ends more than two hours before or starts more than two hours after", () => {
    const far = [griggs("08:00:00", "16:03:00", { driverId: "9" }), griggs("20:28:00", "22:00:00", { driverId: "8" }), griggs("16:10:00", "17:00:00")];
    expect(readDriver(far, at)).toMatchObject({ outcome: "one_driver", driver: { samsaraDriverId: "53867066" }, basis: "before_only" });
  });
});

describe("the confidence", () => {
  const la = candidateIntervals("2026-09-22", "1304", "1327", "LA");
  const one = readDriver(ERWINVILLE_ASSIGNMENTS, la[0]!);

  it("is high for one driver bracketing a GPS-confirmed instant", () => {
    expect(confidenceOf(resolveInstant(la, ERWINVILLE, "LA"), readDriver(ERWINVILLE_ASSIGNMENTS, la[0]!))).toBe("high");
  });

  it("is low when the GPS puts the truck moving or in another state, when the zone is unresolved, or the driver is on one side only", () => {
    expect(confidenceOf({ zoneMethod: "state_only", locationCheck: "moving", instant: la[0]! }, one)).toBe("low");
    expect(confidenceOf({ zoneMethod: "gps", locationCheck: "other_state", instant: la[0]! }, one)).toBe("low");
    expect(confidenceOf({ zoneMethod: "unresolved", locationCheck: "confirmed", instant: null }, one)).toBe("low");
    expect(confidenceOf({ zoneMethod: "gps", locationCheck: "confirmed", instant: la[0]! }, { ...one, basis: "after_only" })).toBe("low");
  });

  it("is high on a one-zone state the GPS was silent about — the state settles the zone", () => {
    expect(confidenceOf({ zoneMethod: "state_only", locationCheck: "no_gps", instant: la[0]! }, one)).toBe("high");
  });

  it("is high on an unresolved zone when the truck stood still in the state and the same driver brackets every candidate", () => {
    const tx = candidateIntervals("2026-09-22", "1304", "1327", "TX"); // Central 18:04Z, Mountain 19:04Z
    const parked = [fix("17:30:00", 0, "TX")]; // held to 18:00 only: no fix speaks for either candidate
    const allDay = [fix("17:00:00", 0, "TX"), fix("17:30:00", 0, "TX"), fix("18:00:00", 0, "TX"), fix("18:30:00", 0, "TX"), fix("19:00:00", 0, "TX"), fix("19:30:00", 0, "TX")];
    const onBothSides = [griggs("12:00:00", "17:40:00"), griggs("20:00:00", "21:00:00")];
    const r = readAttribution(tx, allDay, onBothSides, "TX");
    expect([r.instant.zoneMethod, r.instant.locationCheck, r.driver.basis, r.confidence]).toEqual(["unresolved", "confirmed", "bracketing", "high"]);
    // One assignment ending between the candidates covers Central and is before-only for Mountain: the
    // reading depends on the zone, so it is a person's.
    const dependsOnZone = readAttribution(tx, allDay, [griggs("12:00:00", "18:50:00")], "TX");
    expect([dependsOnZone.driver.basis, dependsOnZone.confidence]).toEqual(["covering", "low"]);
    // Or the GPS cannot place the truck stopped: low.
    expect(readAttribution(tx, parked, onBothSides, "TX").confidence).toBe("low");
  });

  it("is absent when there is no one driver", () => {
    expect(confidenceOf({ zoneMethod: "gps", locationCheck: "confirmed", instant: la[0]! }, readDriver([], la[0]!))).toBeNull();
  });
});

describe("Samsara's payloads", () => {
  it("reads GPS fixes in time order, with the state of each address", () => {
    const record = {
      gps: [
        { time: "2026-09-22T18:09:36.000Z", speedMilesPerHour: 0, reverseGeo: { formattedLocation: "US 190;LA 1, LA, 70767" } },
        { time: "2026-09-22T18:03:11.000Z", speedMilesPerHour: 34.8, reverseGeo: { formattedLocation: "US 190;LA 1, Erwinville, LA, 70767" } },
        { time: "not a time", speedMilesPerHour: 0 },
      ],
    };
    expect(fixesOf(record)).toEqual([fix("18:03:11", 34.8), fix("18:09:36", 0)]);
    expect(fixesOf(undefined)).toEqual([]);
  });

  it("reads assignments, running an open one to the given end", () => {
    const rows = [
      { startTime: "2026-09-22T14:30:21.028Z", endTime: "2026-09-22T18:04:10.047Z", isPassenger: false, driver: { id: "53867066", name: "GREGORY GRIGGS" } },
      { startTime: "2026-09-22T18:42:49.323Z", endTime: "", isPassenger: true, driver: { id: "53867066" } },
      { startTime: "2026-09-22T19:00:00Z", endTime: "2026-09-22T20:00:00Z" },
    ];
    expect(assignmentsOf(rows, t("20:30:00"))).toEqual([
      { driverId: "53867066", driverName: "GREGORY GRIGGS", passenger: false, startMs: Date.parse("2026-09-22T14:30:21.028Z"), endMs: Date.parse("2026-09-22T18:04:10.047Z") },
      { driverId: "53867066", driverName: null, passenger: true, startMs: Date.parse("2026-09-22T18:42:49.323Z"), endMs: t("20:30:00") },
    ]);
  });
});
