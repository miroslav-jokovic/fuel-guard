import { describe, it, expect } from "vitest";
import { localWallClock } from "./wallClock.js";

describe("localWallClock — the store's one clock (D-FIN9)", () => {
  it("a Chicago evening fill on the last day of the month stays in that month", () => {
    // 2026-07-01T04:30:00Z is 23:30 CDT on June 30.
    expect(localWallClock("2026-07-01T04:30:00.000Z", "America/Chicago")).toBe("2026-06-30T23:30:00.000Z");
  });

  it("handles both sides of daylight saving", () => {
    expect(localWallClock("2026-03-08T07:59:00.000Z", "America/Chicago")).toBe("2026-03-08T01:59:00.000Z"); // CST, −6
    expect(localWallClock("2026-03-08T08:00:00.000Z", "America/Chicago")).toBe("2026-03-08T03:00:00.000Z"); // CDT, −5 (02:00 never exists)
    expect(localWallClock("2026-11-01T06:30:00.000Z", "America/Chicago")).toBe("2026-11-01T01:30:00.000Z"); // back on CST
  });

  it("midnight is 00, never 24", () => {
    expect(localWallClock("2026-06-15T05:00:00.000Z", "America/Chicago")).toBe("2026-06-15T00:00:00.000Z");
  });

  it("UTC is the identity, and an unknown zone throws rather than guessing", () => {
    expect(localWallClock("2026-06-15T13:45:10.000Z", "UTC")).toBe("2026-06-15T13:45:10.000Z");
    expect(() => localWallClock("2026-06-15T13:45:10.000Z", "Mars/Olympus")).toThrow();
    expect(() => localWallClock("not a date", "UTC")).toThrow(/not an instant/);
  });
});
