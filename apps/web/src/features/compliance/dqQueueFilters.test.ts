import { describe, expect, it } from "vitest";
import { classifyDqDateFilters, type DqDateFilters } from "./dqQueueFilters";

const filters = (overrides: Partial<DqDateFilters> = {}): DqDateFilters => ({
  goodUntil: {},
  evidenceDate: {},
  ...overrides,
});

describe("classifyDqDateFilters", () => {
  const row = { goodUntil: "2026-09-30", evidenceDate: "2026-01-15" };

  it("matches inclusive good-until and evidence-date ranges", () => {
    expect(
      classifyDqDateFilters(row, filters({
        goodUntil: { from: "2026-09-30", to: "2026-09-30" },
        evidenceDate: { from: "2026-01-01", to: "2026-01-15" },
      })),
    ).toEqual({ kind: "match", missing: [] });
  });

  it("rejects a dated row outside either active range", () => {
    expect(
      classifyDqDateFilters(row, filters({ goodUntil: { from: "2026-10-01" } })),
    ).toEqual({ kind: "outside-range", missing: [] });
  });

  it("reports every selected date that is missing", () => {
    expect(
      classifyDqDateFilters(
        { goodUntil: null, evidenceDate: null },
        filters({
          goodUntil: { from: "2026-01-01" },
          evidenceDate: { to: "2026-12-31" },
        }),
      ),
    ).toEqual({ kind: "missing-date", missing: ["goodUntil", "evidenceDate"] });
  });

  it("does not require a date when its filter is inactive", () => {
    expect(classifyDqDateFilters({ goodUntil: null, evidenceDate: null }, filters())).toEqual({
      kind: "match",
      missing: [],
    });
  });
});
