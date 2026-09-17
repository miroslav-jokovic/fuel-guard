import { describe, it, expect } from "vitest";
import type { LiveMapBoard, LiveMapVehicle } from "@silvicom/shared";
import {
  boardSummarySentence,
  engineOnBoundSentence,
  formatAge,
  fuelMetric,
  offlineBoundSentence,
  rowMetric,
} from "./liveMapWords";

/**
 * The sentences and per-truck metrics the live map renders — split out of `liveMapLayer.test.ts`
 * with the module they cover (2026-09-17), when `fuelMetric` took that file over its size budget.
 *
 * What is held still here is WORDING that carries a decision: D-LM18's scope disclosure, D-LM9b's
 * cadence, D-LM10's fix age, D-LM20's one-slot rule and Q-LM20's fuel rule. Every one of them has
 * been wrong on this surface at least once, and none of them can be seen by a type.
 */
const vehicle = (o: Partial<LiveMapVehicle> = {}): LiveMapVehicle => ({
  vehicleId: "veh-1",
  unitNumber: "1207",
  driver: { id: "drv-1", name: "Ana Ruiz" },
  position: {
    lat: 44.51,
    lng: -88.01,
    headingDegrees: 275,
    speedMph: 62,
    isEcuSpeed: true,
    formattedLocation: "Green Bay, WI",
    sampledAt: "2026-09-15T18:00:00.000Z",
    receivedAt: "2026-09-15T18:00:01.000Z",
  },
  state: "moving",
  ageSeconds: 5,
  fuel: { percent: 68, at: "2026-09-15T17:58:00.000Z" },
  load: null,
  ...o,
});

describe("formatAge", () => {
  it("reads in the unit the number deserves", () => {
    expect(formatAge(2)).toBe("2s ago");
    expect(formatAge(59)).toBe("59s ago");
    expect(formatAge(240)).toBe("4m ago");
    expect(formatAge(7200)).toBe("2h ago");
    // The seven `active` trucks whose telematics stopped more than a week ago — a fleet problem the
    // map is for surfacing, and unreadable as "1468800s ago".
    expect(formatAge(17 * 86_400)).toBe("17d ago");
  });
});

describe("rowMetric", () => {
  /**
   * The rail's right-hand slot (D-LM20). The owner's item 2 was "show SPEED per truck, not '3s ago'",
   * and D-LM10 requires the fix age to stay visible per truck — these are the cases where the two
   * meet, so neither can be quietly traded for the other later.
   */
  it("shows the speed while the feed is keeping up, which is what a reader can act on", () => {
    expect(rowMetric(vehicle({ ageSeconds: 5 }))).toEqual({ text: "62 mph", kind: "speed" });
  });

  it("shows a stopped truck's nought, because the badge says stopped and the number says how stopped", () => {
    expect(rowMetric(vehicle({ state: "stopped", ageSeconds: 8, position: { ...vehicle().position, speedMph: 0 } })))
      .toEqual({ text: "0 mph", kind: "speed" });
  });

  it("shows the AGE once the fix is stale, because a speed read off an old fix is a lie with a number on it", () => {
    // `moving` only asks that the fix is inside the fifteen-minute offline bound, so a truck can be
    // moving with a fix nobody has refreshed in twenty minutes. That row must not read "62 mph".
    expect(rowMetric(vehicle({ state: "moving", ageSeconds: 1_200 }))).toEqual({ text: "20m ago", kind: "age" });
  });

  it("shows the age for a ping that carried no speed, rather than inventing a nought", () => {
    // `speedMph` is nullable in `vehicle_positions` and absent is NOT zero (0341's column is nullable
    // for exactly this).
    expect(rowMetric(vehicle({ ageSeconds: 4, position: { ...vehicle().position, speedMph: null } })))
      .toEqual({ text: "4s ago", kind: "age" });
  });

  it("puts the seam at twice the worst fix interval measured on this fleet, not at a round minute", () => {
    expect(rowMetric(vehicle({ ageSeconds: 30 })).kind).toBe("speed");
    expect(rowMetric(vehicle({ ageSeconds: 31 })).kind).toBe("age");
  });
});

/**
 * `Q-LM20` — the tank, and the one rule that makes a number on a card honest.
 *
 * Every case fails on a named mutation of `fuelMetric`, and each was run: hiding the percentage past
 * the bound fails the stale case, dropping the age from the stale branch fails it too, comparing
 * against a literal 900 instead of `bounds.fuelFreshSeconds` fails the retuned-bound case, and
 * returning a percentage for an unusable timestamp fails the last one.
 */
describe("fuelMetric", () => {
  const BOARD = {
    generatedAt: "2026-09-17T12:00:00.000Z",
    bounds: {
      stoppedSpeedMph: 3,
      engineOnBoundSeconds: 30,
      offlineBoundSeconds: 900,
      fuelFreshSeconds: 900,
    },
  };
  const agoSec = (s: number) =>
    new Date(Date.parse(BOARD.generatedAt) - s * 1000).toISOString();

  it("says the level plainly while the reading is inside the bound", () => {
    const v = vehicle({ fuel: { percent: 68, at: agoSec(120) } });
    expect(fuelMetric(v, BOARD)).toEqual({ text: "68%", stale: false });
  });

  /**
   * ⚠ The number STAYS, which is where this parts company with `rowMetric`. A tank only changes
   * while the engine burns from it, so an old reading is unconfirmed rather than wrong — and on
   * production 24% of the trucks with a LIVE fix carry fuel over an hour old, so hiding it would
   * blank the figure on a quarter of the cards a dispatcher opens.
   */
  it("keeps the level but says how old it is once the reading is past the bound", () => {
    const v = vehicle({ fuel: { percent: 68, at: agoSec(4 * 3600) } });
    expect(fuelMetric(v, BOARD)).toEqual({ text: "68% · read 4h ago", stale: true });
  });

  it("puts the seam exactly on the bound the response sent", () => {
    expect(fuelMetric(vehicle({ fuel: { percent: 50, at: agoSec(900) } }), BOARD)!.stale).toBe(false);
    expect(fuelMetric(vehicle({ fuel: { percent: 50, at: agoSec(901) } }), BOARD)!.stale).toBe(true);
  });

  /** ⚠ Asserted against a bound that is NOT production's, or a literal 900 would pass this file. */
  it("follows a retuned bound rather than a number of its own", () => {
    const tight = { ...BOARD, bounds: { ...BOARD.bounds, fuelFreshSeconds: 60 } };
    expect(fuelMetric(vehicle({ fuel: { percent: 50, at: agoSec(120) } }), tight)!.stale).toBe(true);
  });

  /**
   * ⚠ Null, not "0%". An unknown tank and an empty tank are opposite facts, and 65 of 272 vehicle
   * rows have never carried a reading (production, 2026-09-17).
   */
  it("says nothing at all for a truck that has never reported a level", () => {
    expect(fuelMetric(vehicle({ fuel: null }), BOARD)).toBeNull();
  });

  /** A reading that cannot be placed in time is the thing this function exists to refuse. */
  it("refuses a reading whose timestamp cannot be read", () => {
    expect(fuelMetric(vehicle({ fuel: { percent: 68, at: "not a date" } }), BOARD)).toBeNull();
  });

  /**
   * ⚠ The fuel clock is the BOARD's, never `Date.now()`. Both values come from one response, so the
   * subtraction cannot be wrong by whatever this machine's clock disagrees with the server's — which
   * is the D-LM10 rule kept rather than bent.
   */
  it("ages the tank against the board's own clock", () => {
    const v = vehicle({ fuel: { percent: 68, at: agoSec(2 * 86_400) } });
    const older = { ...BOARD, generatedAt: "2026-09-18T12:00:00.000Z" };
    expect(fuelMetric(v, BOARD)!.text).toBe("68% · read 2d ago");
    expect(fuelMetric(v, older)!.text).toBe("68% · read 3d ago");
  });
});

describe("boardSummarySentence", () => {
  const FLEET = { shown: 171, total: 171, scope: "all", pollSeconds: 5 } as const;

  /** The owner's item 6: "171 of 171 shown" is a fraction whose halves are equal. */
  it("says a plain total when nothing is filtered out", () => {
    expect(boardSummarySentence(FLEET)).toBe("171 trucks in the fleet · refreshes every 5s");
  });

  it("keeps the fraction when the list IS narrowed, which is the case it was written for", () => {
    expect(boardSummarySentence({ ...FLEET, shown: 42 })).toBe(
      "42 of 171 trucks in the fleet · refreshes every 5s",
    );
  });

  it("does not say '1 trucks'", () => {
    expect(boardSummarySentence({ ...FLEET, shown: 1, total: 1 })).toContain("1 truck in the fleet");
    expect(boardSummarySentence({ ...FLEET, shown: 1 })).toContain("1 of 171 trucks in the fleet");
  });

  /**
   * D-LM18 survives item 6 as the clause the count ends in. A dispatcher reading "171 trucks" alone
   * cannot tell whose trucks they are, which is the misreading D-LM18 exists to prevent — so the
   * count is never allowed to stand without it.
   */
  it("says whose trucks the count is counting, in the same sentence as the count (D-LM18)", () => {
    expect(boardSummarySentence(FLEET)).toContain("in the fleet");
  });

  /**
   * ⚠ `mine` has never been in force — D-LM18 ships the board fleet-wide until McLeod grants the
   * dispatcher relation. This is pinned anyway, because the failure it guards against is a sentence
   * that still reads "in the fleet" on the day a dispatcher IS scoped, which no one would notice
   * from the rail and which would be exactly the lie D-LM18 forbids.
   */
  it("changes the clause with the scope rather than describing every board as the fleet", () => {
    expect(boardSummarySentence({ ...FLEET, shown: 12, total: 60, scope: "mine" })).toBe(
      "12 of 60 trucks assigned to you · refreshes every 5s",
    );
  });

  /** D-LM9b: the cadence is the caller's `LIVE_MAP_POLL_MS`, never a typed number. */
  it("takes the cadence from the poll it is given", () => {
    expect(boardSummarySentence({ ...FLEET, pollSeconds: 30 })).toContain("refreshes every 30s");
  });
});

describe("offlineBoundSentence", () => {
  /**
   * ⚠ The legend must READ the bound rather than restate it. `bounds` is on the response precisely
   * so no component holds a second copy, and a hard-coded "15 minutes" is wrong the day it is
   * retuned — so this asserts against a bound that is NOT the production one.
   */
  it("says the bound the response sent, not the one in production today", () => {
    const bounds: LiveMapBoard["bounds"] = {
      stoppedSpeedMph: 3,
      engineOnBoundSeconds: 30,
      offlineBoundSeconds: 1_800,
      fuelFreshSeconds: 900,
    };
    expect(offlineBoundSentence(bounds)).toBe("No fix for over 30 min");
  });

  /**
   * Its sibling, untested until `Q-LM19` gave both of them a renderer — they had been exports with
   * no call site since D-DR25 dropped DR5's legend, which is how D-LM9b's own text left the page
   * without anything failing.
   */
  it("says the engine-on seam from the response too", () => {
    const bounds: LiveMapBoard["bounds"] = {
      stoppedSpeedMph: 3,
      engineOnBoundSeconds: 45,
      offlineBoundSeconds: 900,
      fuelFreshSeconds: 900,
    };
    expect(engineOnBoundSentence(bounds)).toBe("Not moving, heard from within 45s");
  });
});
