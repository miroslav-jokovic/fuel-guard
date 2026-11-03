import { describe, expect, it } from "vitest";
import { bucketHour, isKnownZone, localHourToUtc, windowDays } from "./localHours.js";

const utc = (day: string, hour: number, zone: string) => localHourToUtc(day, hour, zone)?.toISOString() ?? null;

describe("the account's local hour as a UTC hour (B5a)", () => {
  it("an ordinary Central day is six hours behind UTC in winter and five in summer", () => {
    expect(utc("2026-11-03", 14, "America/Chicago")).toBe("2026-11-03T20:00:00.000Z");
    expect(utc("2026-07-15", 14, "America/Chicago")).toBe("2026-07-15T19:00:00.000Z");
  });

  it("on the fall-back day the doubled 01:00 lands on its FIRST UTC hour, and the hours around it on theirs", () => {
    // 2026-11-01: 01:00 CDT = 06:00Z, then 01:00 CST = 07:00Z; 02:00 CST = 08:00Z.
    expect(["00", "01", "02", "03"].map((h) => utc("2026-11-01", Number(h), "America/Chicago"))).toEqual([
      "2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z", "2026-11-01T08:00:00.000Z", "2026-11-01T09:00:00.000Z",
    ]);
  });

  it("on the spring-forward day 02:00 does not exist, and is said to not exist rather than guessed", () => {
    expect(utc("2027-03-14", 1, "America/Chicago")).toBe("2027-03-14T07:00:00.000Z");
    expect(utc("2027-03-14", 2, "America/Chicago")).toBeNull();
    expect(utc("2027-03-14", 3, "America/Chicago")).toBe("2027-03-14T08:00:00.000Z");
  });

  it("a zone on a half-hour offset converts on the half hour, and UTC is itself", () => {
    expect(utc("2026-11-03", 10, "Asia/Kolkata")).toBe("2026-11-03T04:30:00.000Z");
    expect(utc("2026-11-03", 0, "UTC")).toBe("2026-11-03T00:00:00.000Z");
  });

  it("the window is the account's local days, ending on ITS today, not UTC's", () => {
    // 03:00Z on 11-03 is still 21:00 on 11-02 in Chicago.
    expect(windowDays(new Date("2026-11-03T03:00:00Z"), "America/Chicago", 3)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(windowDays(new Date("2026-11-03T03:00:00Z"), "UTC", 1)).toEqual(["2026-11-03"]);
  });

  it("reads only Meta's bucket shape, and only a zone the runtime knows", () => {
    expect([bucketHour("00:00:00 - 00:59:59"), bucketHour("23:00:00 - 23:59:59")]).toEqual([0, 23]);
    expect([bucketHour("14:00:00 - 15:59:59"), bucketHour("24:00:00 - 24:59:59"), bucketHour(14), bucketHour("14")]).toEqual([null, null, null, null]);
    expect([isKnownZone("America/Chicago"), isKnownZone("Mars/Olympus"), isKnownZone(""), isKnownZone(undefined)]).toEqual([true, false, false, false]);
  });
});
