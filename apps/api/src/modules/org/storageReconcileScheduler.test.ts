import { describe, it, expect } from "vitest";
import { storageReconcileDueDay } from "./storageReconcileScheduler.js";

describe("storageReconcileDueDay", () => {
  // 2026-07-06T11:00:00Z = 06:00 America/Chicago (CDT, −5); 2026-01-06T12:00:00Z = 06:00 CST (−6).
  const at6amCdt = Date.parse("2026-07-06T11:00:00Z");
  const at6amCst = Date.parse("2026-01-06T12:00:00Z");

  it("is due at 06:00 Central on a day it has not run, and names that Central day", () => {
    expect(storageReconcileDueDay(at6amCdt, null)).toBe("2026-07-06");
    expect(storageReconcileDueDay(at6amCdt + 45 * 60_000, "2026-07-05")).toBe("2026-07-06");
  });

  it("follows the Central clock through standard time, not a fixed UTC hour", () => {
    expect(storageReconcileDueDay(at6amCst, null)).toBe("2026-01-06");
    expect(storageReconcileDueDay(at6amCst - 3_600_000, null)).toBeNull();
  });

  it("is not due outside 06:00, including the 01:00 release that boots the process", () => {
    expect(storageReconcileDueDay(at6amCdt - 5 * 3_600_000, null)).toBeNull();
    expect(storageReconcileDueDay(at6amCdt + 3_600_000, null)).toBeNull();
  });

  it("is not due twice in one Central day, so the 15-minute ticker fires once", () => {
    expect(storageReconcileDueDay(at6amCdt + 15 * 60_000, "2026-07-06")).toBeNull();
  });
});
