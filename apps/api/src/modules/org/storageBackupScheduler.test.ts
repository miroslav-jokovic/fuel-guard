import { describe, it, expect } from "vitest";
import { isStorageBackupDue } from "./storageBackupScheduler.js";

describe("isStorageBackupDue", () => {
  // 2026-10-21T09:00:00Z = 04:00 America/Chicago (CDT, −5); 2026-01-06T10:00:00Z = 04:00 CST (−6).
  const at4amCdt = Date.parse("2026-10-21T09:00:00Z");
  const at4amCst = Date.parse("2026-01-06T10:00:00Z");
  const H = 3_600_000;

  it("is due at any hour when no copy has ever succeeded — the deploy that ships it", () => {
    expect(isStorageBackupDue(at4amCdt + 9 * H, null, null)).toBe(true);
  });

  it("is due at 04:00 Central when the last success was an earlier Central day", () => {
    expect(isStorageBackupDue(at4amCdt, at4amCdt - 24 * H, null)).toBe(true);
    expect(isStorageBackupDue(at4amCst, at4amCst - 24 * H, null)).toBe(true);
  });

  it("is not due outside 04:00 while the last success is recent", () => {
    expect(isStorageBackupDue(at4amCdt + 2 * H, at4amCdt - 22 * H, null)).toBe(false);
    expect(isStorageBackupDue(at4amCst - H, at4amCst - 25 * H, null)).toBe(false);
  });

  it("is not due twice in one Central day", () => {
    expect(isStorageBackupDue(at4amCdt + 45 * 60_000, at4amCdt + 20 * 60_000, null)).toBe(false);
  });

  it("catches up a missed night at any hour once 30 hours have passed", () => {
    expect(isStorageBackupDue(at4amCdt + 8 * H, at4amCdt - 22 * H, null)).toBe(true);
  });

  it("waits an hour after a failed run before trying again, even when overdue", () => {
    expect(isStorageBackupDue(at4amCdt, null, at4amCdt - 30 * 60_000)).toBe(false);
    expect(isStorageBackupDue(at4amCdt, null, at4amCdt - 61 * 60_000)).toBe(true);
  });
});
