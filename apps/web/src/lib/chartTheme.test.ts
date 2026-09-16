import { describe, it, expect } from "vitest";
import { areaFill, BAR_GEOMETRY, lastPointRadius, resolveAlpha } from "./chartTheme";

// resolveAlpha must produce a genuinely translucent rgba() so gradient/wash fills fade — regardless of
// how the browser serialized the base color. If it ever returns the opaque color, area fills go solid.
describe("resolveAlpha", () => {
  it("returns a translucent rgba() carrying the requested alpha (jsdom hex fallback path)", () => {
    const out = resolveAlpha("--viz-spend", 0.3);
    expect(out).toMatch(/^rgba\(\d+, \d+, \d+, 0\.3\)$/);
  });

  it("distinct alphas yield distinct strings (a gradient needs different stops)", () => {
    const a = resolveAlpha("--viz-brand", 0.3);
    const b = resolveAlpha("--viz-brand", 0);
    expect(a).not.toBe(b);
    expect(a).toContain("0.3");
    expect(b).not.toContain("0.3");
  });
});

/**
 * The DR3 chart geometry (DESIGN-REFRESH-2026-09.md §3).
 *
 * Every number below came off comp (3)'s PNG a pixel at a time on 2026-09-16, not off a screenshot
 * — reading the picture had already produced one wrong answer (a row of point dots on the MPG line
 * that turns out to be the antialiasing of a 2px stroke). These pin the readings so a later tidy-up
 * cannot quietly undo them.
 */
describe("areaFill defaults (DR3)", () => {
  /** Sample a gradient stop by asking `resolveAlpha` for the same alpha the fill would use there. */
  const alphaOf = (s: string) => Number(/,\s*([\d.]+)\)$/.exec(s)?.[1] ?? NaN);

  it("washes at roughly half the old strength, which is what the comp measures", () => {
    // Before DR3: top 0.3, mid 0.08. The comp reads ~0.047 under the line and ~0.012 near the
    // baseline; the old defaults computed to ~0.128 and ~0.009 at those depths.
    const fill = areaFill("--viz-brand");
    expect(typeof fill).toBe("function");
    // The fallback path (no chart area yet, and jsdom has no canvas gradients) returns the MID
    // colour, so it is the one stop a unit test can hold still.
    const flat = fill({ chart: { ctx: {} as CanvasRenderingContext2D } });
    expect(alphaOf(String(flat))).toBeCloseTo(0.045, 3);
  });

  it("still lets a caller pass its own wash, which is how D-FRUI7's three-series tuning survives", () => {
    const fill = areaFill("--viz-money-kept", { top: 0.3, mid: 0.08, midAt: 0.55, fadeAt: 1 });
    const flat = fill({ chart: { ctx: {} as CanvasRenderingContext2D } });
    expect(alphaOf(String(flat))).toBeCloseTo(0.08, 3);
  });
});

describe("BAR_GEOMETRY (DR3)", () => {
  it("skips the bottom edge, so a bar stands on the axis instead of floating", () => {
    // Chart.js rounds every corner NOT adjacent to the skipped edge. Without this the bar gets four
    // rounded corners and stops reading as a quantity resting on a baseline — the comp's bars are
    // square at the bottom.
    expect(BAR_GEOMETRY.borderSkipped).toBe("bottom");
    expect(BAR_GEOMETRY.borderRadius).toBeGreaterThan(0);
  });

  it("fills about 85% of its band, which is the comp's 9-10px bar beside a 1-2px gap", () => {
    const occupancy = BAR_GEOMETRY.categoryPercentage * BAR_GEOMETRY.barPercentage;
    expect(occupancy).toBeGreaterThan(0.8);
    expect(occupancy).toBeLessThan(0.9);
  });

  it("caps the bar width, because this dashboard's range is an arbitrary from/to", () => {
    // A seven-day window across a 900px card would otherwise draw 120px slabs on which a 4px radius
    // reads as square.
    expect(BAR_GEOMETRY.maxBarThickness).toBeLessThanOrEqual(32);
  });
});

describe("lastPointRadius (DR3, D-FRUI7's R5 ruling)", () => {
  it("draws one dot, on the last point, and nothing along the line", () => {
    const r = lastPointRadius(12);
    expect(r({ dataIndex: 12 })).toBe(4);
    expect(r({ dataIndex: 11 })).toBe(0);
    expect(r({ dataIndex: 0 })).toBe(0);
  });

  it("takes the radius as an argument, so a denser chart can shrink it without a second helper", () => {
    expect(lastPointRadius(3, 5)({ dataIndex: 3 })).toBe(5);
  });
});
