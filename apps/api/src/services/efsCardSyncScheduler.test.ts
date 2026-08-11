import { describe, expect, it } from "vitest";
import { isEfsCardSyncDue } from "./efsCardSyncScheduler.js";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("isEfsCardSyncDue", () => {
  it("runs when there is no successful mirror sweep yet", () => {
    expect(isEfsCardSyncDue(null, NOW, DAY)).toBe(true);
  });

  it("skips a successful sweep within the configured cadence", () => {
    expect(isEfsCardSyncDue("2026-08-10T12:01:00.000Z", NOW, DAY)).toBe(false);
    expect(isEfsCardSyncDue("2026-08-10T12:00:00.000Z", NOW, DAY)).toBe(true);
  });

  it("runs when the stored timestamp is invalid so a bad ledger value cannot disable refresh forever", () => {
    expect(isEfsCardSyncDue("not-a-timestamp", NOW, DAY)).toBe(true);
  });
});
