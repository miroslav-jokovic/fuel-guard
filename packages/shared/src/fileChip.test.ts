import { describe, expect, it } from "vitest";
import { FILE_CHIPS, FILE_CHIP_LABELS, fileChip, matchesFileChip, unitFileChip } from "./fileChip.js";
import type { UnitFileCell } from "./unitFileContract.js";

const counts = (over: Partial<Record<"current" | "expiring" | "expired" | "missing", number>> = {}) => ({
  current: 0, expiring: 0, expired: 0, missing: 0, ...over,
});

describe("fileChip", () => {
  it("lets the worst state win: expired, then missing, then date only, then expiring", () => {
    const all = counts({ expired: 1, missing: 3, expiring: 2 });
    expect(fileChip({ state: "incomplete", counts: all, dateOnly: 1 })).toEqual({ kind: "expired", n: 1, label: "1 expired" });
    expect(fileChip({ state: "incomplete", counts: { ...all, expired: 0 }, dateOnly: 1 })).toEqual({ kind: "missing", n: 2, label: "2 missing" });
    expect(fileChip({ state: "incomplete", counts: { ...all, expired: 0 }, dateOnly: 3 })).toEqual({ kind: "date_only", n: 3, label: "3 date only" });
    expect(fileChip({ state: "complete", counts: counts({ current: 4, expiring: 2 }) })).toEqual({ kind: "expiring", n: 2, label: "2 expiring" });
    expect(fileChip({ state: "complete", counts: counts({ current: 4 }) })).toEqual({ kind: "complete", n: 0, label: "Complete" });
  });

  it("says not started when nothing at all is filed, whatever the counts", () => {
    expect(fileChip({ state: "not_started", counts: counts({ missing: 5 }), dateOnly: 2 }).kind).toBe("not_started");
  });

  it("counts a unit's date-only items out of its missing ones", () => {
    const item = (key: string, dated: boolean): UnitFileCell => ({
      key, group: "registration", state: "missing", goodUntil: null, evidenceDate: null, expiryUnknown: false, fleetWide: false, documentId: null,
      dateOnly: dated ? { goodUntil: "2027-01-01", state: "current" } : null,
    });
    const row = { state: "incomplete" as const, counts: counts({ missing: 2 }), items: [item("registration", true), item("annual_inspection", true)] };
    expect(unitFileChip(row)).toMatchObject({ kind: "date_only", n: 2 });
    expect(unitFileChip({ ...row, items: [item("registration", true), item("annual_inspection", false)] })).toMatchObject({ kind: "missing", n: 1 });
  });
});

describe("matchesFileChip", () => {
  it("is the chip's own kind, so the number clicked is the number listed", () => {
    const chip = fileChip({ state: "incomplete", counts: counts({ expiring: 1 }) });
    expect(matchesFileChip(chip, "expiring")).toBe(true);
    expect(matchesFileChip(chip, "complete")).toBe(false);
  });

  it("treats an unknown value as no filter", () => {
    expect(matchesFileChip(fileChip({ state: "complete", counts: counts() }), "banana")).toBe(true);
  });

  it("labels every chip", () => {
    for (const c of FILE_CHIPS) expect(FILE_CHIP_LABELS[c]).toBeTruthy();
  });
});
