import { describe, expect, it } from "vitest";
import { FILE_CHIPS, FILE_CHIP_LABELS, FILE_FILTER_LABELS, FILE_FILTERS, fileChip, fileFilterOptions, matchesFileChip, matchesFileFilter, unitFileChip } from "./fileChip.js";
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
      dateOnly: dated ? { goodUntil: "2027-01-01", state: "current" } : null, paperOnFile: null,
    });
    const row = { state: "incomplete" as const, counts: counts({ missing: 2 }), items: [item("registration", true), item("annual_inspection", true)] };
    expect(unitFileChip(row)).toMatchObject({ kind: "date_only", n: 2 });
    expect(unitFileChip({ ...row, items: [item("registration", true), item("annual_inspection", false)] })).toMatchObject({ kind: "missing", n: 1 });
  });

  // Q-UF13: the paper is on file, nobody has dated it. Counted out of missing, below date only, and an
  // item with both a paper and a McLeod date counts once — as not dated.
  it("counts a unit's not-dated items out of its missing ones, once each, below date only", () => {
    const item = (key: string, dated: boolean, paper: boolean): UnitFileCell => ({
      key, group: "registration", state: "missing", goodUntil: null, evidenceDate: null, expiryUnknown: false, fleetWide: false, documentId: null,
      dateOnly: dated ? { goodUntil: "2027-01-01", state: "current" } : null,
      paperOnFile: paper ? { documentId: `d-${key}`, datedAt: "2026-02-23" } : null,
    });
    const row = (...items: UnitFileCell[]) => ({ state: "incomplete" as const, counts: counts({ missing: items.length }), items });
    expect(unitFileChip(row(item("registration", true, true), item("annual_inspection", false, true)))).toEqual({ kind: "not_dated", n: 2, label: "2 not dated" });
    expect(unitFileChip(row(item("registration", true, true), item("annual_inspection", true, false)))).toMatchObject({ kind: "date_only", n: 1 });
    expect(unitFileChip(row(item("registration", false, true), item("insurance", false, false)))).toMatchObject({ kind: "missing", n: 1 });
  });

  it("reads the not-dated word whole on a toolbar, where no thumbnail stands beside it", () => {
    expect(FILE_FILTER_LABELS.not_dated).toBe("Paper on file, not dated");
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

describe("matchesFileFilter (Q-UF9)", () => {
  const chip = (kind: (typeof FILE_CHIPS)[number]) => ({ kind, n: 0, label: "" });

  it("needs attention admits every chip but complete", () => {
    for (const kind of FILE_CHIPS) expect(matchesFileFilter(chip(kind), "attention")).toBe(kind !== "complete");
  });

  it("a chip word is the chip, and an unknown word is no filter", () => {
    expect(matchesFileFilter(chip("expiring"), "expiring")).toBe(true);
    expect(matchesFileFilter(chip("expired"), "expiring")).toBe(false);
    expect(matchesFileFilter(chip("expired"), "banana")).toBe(true);
  });

  it("offers Any, then every filter word once", () => {
    expect(fileFilterOptions().map((o) => o.value)).toEqual(["", ...FILE_FILTERS]);
  });
});
