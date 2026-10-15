import { describe, expect, it } from "vitest";
import { medstopKeyThreshold, medstopSweepTrouble } from "./medstopConnection.js";

describe("medstopKeyThreshold (D-MSUX21)", () => {
  const today = "2026-10-15";

  it("is silent with no expiry recorded or further off than 30 days", () => {
    expect(medstopKeyThreshold(null, today)).toBeNull();
    expect(medstopKeyThreshold("2026-11-15", today)).toBeNull(); // 31 days
  });

  it("names the threshold the days left fall into, so a missed day still sends it", () => {
    expect(medstopKeyThreshold("2026-11-14", today)).toBe(30); // 30 days
    expect(medstopKeyThreshold("2026-11-04", today)).toBe(30); // 20 days
    expect(medstopKeyThreshold("2026-10-29", today)).toBe(14);
    expect(medstopKeyThreshold("2026-10-25", today)).toBe(14); // 10 days
    expect(medstopKeyThreshold("2026-10-22", today)).toBe(7);
    expect(medstopKeyThreshold("2026-10-18", today)).toBe(3);
    expect(medstopKeyThreshold("2026-10-16", today)).toBe(1);
    expect(medstopKeyThreshold("2026-10-15", today)).toBe(0);
  });

  it("says expired once the day has passed", () => {
    expect(medstopKeyThreshold("2026-10-14", today)).toBe("expired");
  });
});

describe("medstopSweepTrouble (D-MSUX22)", () => {
  const now = Date.parse("2026-10-15T18:00:00Z");

  it("does not judge a connection never swept", () => {
    expect(medstopSweepTrouble(null, null, now)).toBeNull();
  });

  it("calls a sweep whose last attempt failed failed, however recent", () => {
    expect(medstopSweepTrouble("2026-10-15T17:55:00Z", "Med-Stop (401)", now)).toBe("failed");
  });

  it("calls a sweep stopped past three hours without an attempt, and fine at three", () => {
    expect(medstopSweepTrouble("2026-10-15T15:00:00Z", null, now)).toBeNull();
    expect(medstopSweepTrouble("2026-10-15T14:59:00Z", null, now)).toBe("stopped");
  });
});
