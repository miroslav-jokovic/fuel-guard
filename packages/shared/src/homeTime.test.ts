import { describe, expect, it } from "vitest";
import {
  HOME_TIME_BACKDATE_DAYS,
  compareHomeTimes,
  homeTimeChipUrgent,
  homeTimeChips,
  homeTimeHold,
  homeTimeState,
  homeTimeTimesRefusal,
  isHomeTimeLive,
  truckPastLimit,
} from "./homeTime.js";
import { HOME_TIME_DEFAULTS, homeTimeChangeSchema, homeTimeMarkSchema } from "./homeTimeContract.js";
import { rolesThatManage } from "./auth.js";
import { EDITABLE_PERMISSIONS, HOME_TIME_PERMISSION, effectivePermission, shippedPermission } from "./rolePermissions.js";
import { needsAttention, boardFlags } from "./dispatchBoard.js";

const NOW = new Date("2026-11-13T15:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();
const period = (over: Partial<{ startAt: string; expectedReturnAt: string; endAt: string | null; canceledAt: string | null }> = {}) => ({
  startAt: hours(-48),
  expectedReturnAt: hours(72),
  endAt: null,
  canceledAt: null,
  ...over,
});

describe("homeTimeState", () => {
  it("is scheduled until the start, active until the return, overdue after it", () => {
    expect(homeTimeState(period({ startAt: hours(1) }), NOW)).toBe("scheduled");
    expect(homeTimeState(period(), NOW)).toBe("active");
    expect(homeTimeState(period({ expectedReturnAt: hours(-1) }), NOW)).toBe("overdue");
  });

  it("calls the return instant itself overdue, and the start instant itself active", () => {
    expect(homeTimeState(period({ expectedReturnAt: NOW.toISOString() }), NOW)).toBe("overdue");
    expect(homeTimeState(period({ startAt: NOW.toISOString() }), NOW)).toBe("active");
  });

  it("is ended once it has an end, whatever the return time said", () => {
    expect(homeTimeState(period({ endAt: hours(-2), expectedReturnAt: hours(-10) }), NOW)).toBe("ended");
  });

  it("reads a canceled period as canceled although its end is null", () => {
    const canceled = period({ canceledAt: hours(-1) });
    expect(homeTimeState(canceled, NOW)).toBe("canceled");
    expect(isHomeTimeLive(canceled)).toBe(false);
    expect(isHomeTimeLive(period())).toBe(true);
    expect(isHomeTimeLive(period({ endAt: hours(-1) }))).toBe(false);
  });
});

describe("homeTimeTimesRefusal", () => {
  it("accepts a start now and a return ahead", () => {
    expect(homeTimeTimesRefusal({ startAt: NOW.toISOString(), expectedReturnAt: hours(96) }, NOW)).toBeNull();
  });

  it("accepts a forgotten period started inside the backdate limit and refuses one before it", () => {
    const inside = hours(-(HOME_TIME_BACKDATE_DAYS * 24 - 1));
    const before = hours(-(HOME_TIME_BACKDATE_DAYS * 24 + 1));
    expect(homeTimeTimesRefusal({ startAt: inside, expectedReturnAt: hours(24) }, NOW)).toBeNull();
    expect(homeTimeTimesRefusal({ startAt: before, expectedReturnAt: hours(24) }, NOW)).toMatch(/30 days back/);
  });

  it("refuses a return that has already passed, and one not after the start", () => {
    expect(homeTimeTimesRefusal({ startAt: hours(-48), expectedReturnAt: hours(-1) }, NOW)).toMatch(/has passed/);
    expect(homeTimeTimesRefusal({ startAt: hours(5), expectedReturnAt: hours(5) }, NOW)).toMatch(/after the start/);
  });

  it("refuses a time that is not one", () => {
    expect(homeTimeTimesRefusal({ startAt: "soon", expectedReturnAt: hours(5) }, NOW)).toMatch(/date and time/);
  });
});

describe("homeTimeChips", () => {
  const chips = (p: Parameters<typeof period>[0], disposition: "with_driver" | "at_yard" | "no_truck", says = false) => {
    const times = period(p);
    return homeTimeChips({ ...times, disposition }, homeTimeState(times, NOW), HOME_TIME_DEFAULTS, NOW, says);
  };

  it("says scheduled before the start and nothing else", () => {
    expect(chips({ startAt: hours(30), expectedReturnAt: hours(200) }, "with_driver")).toEqual(["scheduled"]);
  });

  it("says home when the row's Available does not already say it, and nothing when it does", () => {
    expect(chips({}, "at_yard")).toEqual(["home"]);
    expect(chips({}, "with_driver", true)).toEqual([]);
  });

  it("warns inside the carrier's window before the return, to the hour", () => {
    expect(chips({ expectedReturnAt: hours(24) }, "at_yard")).toEqual(["return_due"]);
    expect(chips({ expectedReturnAt: hours(25) }, "at_yard")).toEqual(["home"]);
    // The warning is said even when Available says "Home until": it is the news, not a repeat.
    expect(chips({ expectedReturnAt: hours(3) }, "with_driver", true)).toEqual(["return_due"]);
  });

  it("says overdue past the return, and adds the truck limit once the truck has been home that long", () => {
    expect(chips({ expectedReturnAt: hours(-3) }, "at_yard")).toEqual(["overdue"]);
    expect(chips({ startAt: hours(-8 * 24), expectedReturnAt: hours(-3) }, "with_driver")).toEqual(["overdue", "truck_limit"]);
  });

  it("counts the truck limit from the start in whole days, only for a truck with its driver", () => {
    expect(chips({ startAt: hours(-8 * 24 + 1), expectedReturnAt: hours(72) }, "with_driver", true)).toEqual([]);
    expect(chips({ startAt: hours(-8 * 24), expectedReturnAt: hours(72) }, "with_driver", true)).toEqual(["truck_limit"]);
    expect(chips({ startAt: hours(-20 * 24), expectedReturnAt: hours(72) }, "at_yard")).toEqual(["home"]);
    expect(chips({ startAt: hours(-20 * 24), expectedReturnAt: hours(72) }, "no_truck")).toEqual(["home"]);
  });

  it("uses the carrier's own thresholds, not the defaults", () => {
    const times = period({ startAt: hours(-3 * 24), expectedReturnAt: hours(40) });
    const own = { returnDueHours: 48, overdueAfterHours: 2, truckLimitDays: 3 };
    expect(homeTimeChips({ ...times, disposition: "with_driver" }, "active", own, NOW, true)).toEqual(["truck_limit", "return_due"]);
  });

  it("says nothing about a closed period", () => {
    expect(chips({ endAt: hours(-1) }, "with_driver")).toEqual([]);
    expect(chips({ canceledAt: hours(-1) }, "with_driver")).toEqual([]);
  });

  it("makes exactly overdue and the truck limit urgent", () => {
    expect((["scheduled", "home", "return_due", "overdue", "truck_limit"] as const).filter(homeTimeChipUrgent)).toEqual(["overdue", "truck_limit"]);
  });

  it("does not count a scheduled truck against the limit", () => {
    expect(truckPastLimit({ startAt: hours(-30 * 24), disposition: "with_driver" }, "scheduled", HOME_TIME_DEFAULTS, NOW)).toBe(false);
    expect(truckPastLimit({ startAt: hours(-30 * 24), disposition: "with_driver" }, "ended", HOME_TIME_DEFAULTS, NOW)).toBe(false);
  });
});

describe("homeTimeHold", () => {
  const seat = (state: "scheduled" | "active" | "overdue", disposition: "with_driver" | "at_yard" | "no_truck", back = hours(72)) => ({
    state,
    disposition,
    expectedReturnAt: back,
  });

  it("holds a solo truck that is home with its driver, until his return", () => {
    expect(homeTimeHold([seat("active", "with_driver")])).toEqual({ until: hours(72) });
  });

  it("still holds it when he is overdue — the truck is not back either", () => {
    expect(homeTimeHold([seat("overdue", "with_driver", hours(-5))])).toEqual({ until: hours(-5) });
  });

  it("does not hold a truck left at the yard, nor one whose driver is only scheduled", () => {
    expect(homeTimeHold([seat("active", "at_yard")])).toBeNull();
    expect(homeTimeHold([seat("scheduled", "with_driver")])).toBeNull();
  });

  it("does not hold a team truck with one seat home", () => {
    expect(homeTimeHold([seat("active", "with_driver"), null])).toBeNull();
  });

  it("holds a team truck with both seats home until the later return", () => {
    expect(homeTimeHold([seat("active", "with_driver", hours(48)), seat("active", "at_yard", hours(96))])).toEqual({ until: hours(96) });
  });

  it("never holds a truck with no driver", () => {
    expect(homeTimeHold([])).toBeNull();
  });
});

describe("compareHomeTimes", () => {
  it("lists overdue first, then home, then scheduled, each by the return; closed ones last, newest first", () => {
    const rows = [
      { id: "ended-old", state: "ended" as const, expectedReturnAt: hours(-300), startAt: hours(-500) },
      { id: "scheduled", state: "scheduled" as const, expectedReturnAt: hours(200), startAt: hours(100) },
      { id: "home-later", state: "active" as const, expectedReturnAt: hours(90), startAt: hours(-10) },
      { id: "canceled-new", state: "canceled" as const, expectedReturnAt: hours(-100), startAt: hours(-200) },
      { id: "overdue", state: "overdue" as const, expectedReturnAt: hours(-4), startAt: hours(-100) },
      { id: "home-sooner", state: "active" as const, expectedReturnAt: hours(20), startAt: hours(-30) },
    ];
    expect([...rows].sort(compareHomeTimes).map((r) => r.id)).toEqual(["overdue", "home-sooner", "home-later", "scheduled", "canceled-new", "ended-old"]);
  });
});

describe("the write schemas", () => {
  const base = { driverId: "0b0e7c1e-58a5-4f8e-9c59-5b9f0e6f3a11", startAt: hours(0), expectedReturnAt: hours(96) };
  const truck = "7a3f6f3e-2f0b-4d34-8a55-0c2b5f1e9d22";

  it("names a truck exactly when the driver has one", () => {
    expect(homeTimeMarkSchema.safeParse({ ...base, disposition: "with_driver", vehicleId: truck }).success).toBe(true);
    expect(homeTimeMarkSchema.safeParse({ ...base, disposition: "no_truck", vehicleId: null }).success).toBe(true);
    expect(homeTimeMarkSchema.safeParse({ ...base, disposition: "with_driver", vehicleId: null }).success).toBe(false);
    expect(homeTimeMarkSchema.safeParse({ ...base, disposition: "no_truck", vehicleId: truck }).success).toBe(false);
  });

  it("refuses a return not after the start", () => {
    expect(homeTimeMarkSchema.safeParse({ ...base, expectedReturnAt: base.startAt, disposition: "no_truck", vehicleId: null }).success).toBe(false);
  });

  it("changes only what is sent, never to 'no truck', and refuses an empty change", () => {
    expect(homeTimeChangeSchema.safeParse({ expectedReturnAt: hours(120) }).success).toBe(true);
    expect(homeTimeChangeSchema.safeParse({ disposition: "at_yard" }).success).toBe(true);
    expect(homeTimeChangeSchema.safeParse({ disposition: "no_truck" }).success).toBe(false);
    expect(homeTimeChangeSchema.safeParse({}).success).toBe(false);
  });
});

describe("the permission to mark home time", () => {
  it("ships to exactly the editable roles that manage Dispatch, read from the matrix", () => {
    const entry = EDITABLE_PERMISSIONS.find((p) => p.key === HOME_TIME_PERMISSION)!;
    expect([...entry.shippedRoles].sort()).toEqual(rolesThatManage("dispatch").filter((r) => r !== "admin").sort());
    expect(shippedPermission("dispatcher", HOME_TIME_PERMISSION)).toBe(true);
    expect(shippedPermission("fleet_manager", HOME_TIME_PERMISSION)).toBe(true);
    expect(shippedPermission("admin", HOME_TIME_PERMISSION)).toBe(true);
    expect(shippedPermission("safety_manager", HOME_TIME_PERMISSION)).toBe(false);
    expect(shippedPermission("driver", HOME_TIME_PERMISSION)).toBe(false);
  });

  it("is the carrier's to switch off for a role", () => {
    expect(effectivePermission("dispatcher", HOME_TIME_PERMISSION, { dispatcher: { [HOME_TIME_PERMISSION]: false } })).toBe(false);
    expect(effectivePermission("recruiter", HOME_TIME_PERMISSION, { recruiter: { [HOME_TIME_PERMISSION]: true } })).toBe(true);
  });
});

describe("the board's attention flag", () => {
  it("counts an urgent home time as needing attention, and nothing else changes", () => {
    const flags = boardFlags({ inShop: false, current: null, next: null, onTime: "unknown", hos: null, gpsAgeSeconds: 10 });
    expect(flags.homeTimeUrgent).toBe(false);
    expect(needsAttention(flags)).toBe(false);
    expect(needsAttention({ ...flags, homeTimeUrgent: true })).toBe(true);
  });
});
