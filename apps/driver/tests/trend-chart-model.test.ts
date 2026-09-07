import { describe, expect, it } from 'vitest';
import {
  areaPath,
  calloutAnchor,
  domain,
  gridlines,
  points,
  smoothPath,
} from '@/features/score/trendChartModel';

const PAD = { left: 26, right: 10, top: 8, bottom: 18 };

describe('domain', () => {
  it('starts ten below the lowest week, so real differences are visible', () => {
    // A 0–100 axis wastes two thirds of the height on a band no driver ever occupies.
    expect(domain([87, 91, 89])).toEqual({ min: 80, max: 100 });
    expect(domain([72, 80, 78])).toEqual({ min: 60, max: 100 });
    expect(domain([40, 55])).toEqual({ min: 30, max: 100 });
  });

  it('never drops below zero, whatever the scores', () => {
    expect(domain([3, 8])).toEqual({ min: 0, max: 100 });
    expect(domain([0])).toEqual({ min: 0, max: 100 });
  });

  it('keeps the ceiling at 100 — the grade has a real maximum', () => {
    // Fitting the top to the data would flatter a driver whose best week was 62.
    expect(domain([58, 62]).max).toBe(100);
  });

  it('is a full 0–100 with no weeks at all', () => {
    expect(domain([])).toEqual({ min: 0, max: 100 });
  });
});

describe('gridlines', () => {
  it('steps by ten from the floor to the ceiling inclusive', () => {
    expect(gridlines([87, 91])).toEqual([80, 90, 100]);
    expect(gridlines([72])).toEqual([60, 70, 80, 90, 100]);
  });
});

describe('points', () => {
  const values = [80, 90, 100];
  const pts = points(values, 350, 150);

  it('spreads the weeks across the inner width, first to last', () => {
    expect(pts).toHaveLength(3);
    expect(pts[0]!.x).toBeCloseTo(PAD.left, 5);
    expect(pts[2]!.x).toBeCloseTo(350 - PAD.right, 5);
    expect(pts[1]!.x).toBeCloseTo((PAD.left + 350 - PAD.right) / 2, 5);
  });

  it('pins a perfect week to the top of the plot', () => {
    expect(pts[2]!.y).toBeCloseTo(PAD.top, 5);
  });

  it('always leaves air under the lowest week, so the line never sits on the axis', () => {
    // `domain` floors to the ten below (min − 5), which is what guarantees the gap. A line touching
    // the bottom rule reads as clipped rather than as a low score.
    for (const series of [[80, 90, 100], [40, 55], [61, 62, 63]]) {
      const plotted = points(series, 350, 150);
      const lowest = Math.max(...plotted.map((p) => p.y));
      expect(lowest).toBeLessThan(150 - PAD.bottom);
    }
  });

  it('places a week proportionally between those ends', () => {
    const { min, max } = domain(values);
    const innerH = 150 - PAD.top - PAD.bottom;
    for (const p of pts) {
      expect(p.y).toBeCloseTo(PAD.top + (1 - (p.value - min) / (max - min)) * innerH, 5);
    }
  });

  it('keeps y INVERTED — a better score is higher on the screen', () => {
    expect(pts[2]!.y).toBeLessThan(pts[0]!.y);
  });

  it('centres a lone week instead of pinning it to the left edge', () => {
    const one = points([88], 350, 150);
    expect(one[0]!.x).toBeCloseTo(PAD.left + (350 - PAD.left - PAD.right) / 2, 5);
  });

  it('carries each value and index through, so a label never re-derives them', () => {
    expect(pts.map((p) => p.value)).toEqual(values);
    expect(pts.map((p) => p.index)).toEqual([0, 1, 2]);
  });
});

describe('smoothPath', () => {
  it('is one move and a curve per gap', () => {
    const d = smoothPath(points([80, 85, 90, 95], 350, 150));
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.match(/C/g)).toHaveLength(3);
  });

  it('passes THROUGH every week, not near it', () => {
    // Each point is a real grade a driver can look up; a spline that misses them is a drawing of
    // the trend rather than the trend.
    const pts = points([80, 92, 86], 350, 150);
    const d = smoothPath(pts);
    for (const p of pts) {
      expect(d).toContain(`${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`);
    }
  });

  it('degenerates safely', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath(points([88], 350, 150))).toMatch(/^M /);
  });
});

describe('areaPath', () => {
  it('closes the fill along the baseline', () => {
    const d = areaPath(points([80, 90], 350, 150), 150);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain(`L ${350 - PAD.right} ${150 - PAD.bottom}`);
  });

  it('is empty below two weeks — there is no area under one point', () => {
    expect(areaPath(points([88], 350, 150), 150)).toBe('');
  });
});

describe('calloutAnchor', () => {
  it('hangs above and left of the newest week', () => {
    const pts = points([80, 90], 350, 150);
    const a = calloutAnchor(pts[1], 350)!;
    expect(a.y).toBeLessThan(pts[1]!.y);
    expect(a.x).toBeLessThan(pts[1]!.x);
  });

  it('clamps inside the chart, which is exactly where a right-anchored series would overflow', () => {
    const pts = points([80, 90], 350, 150);
    const a = calloutAnchor(pts[1], 350, 76)!;
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x + 76).toBeLessThanOrEqual(350);
  });

  it('clamps to zero rather than going negative on a narrow chart', () => {
    const a = calloutAnchor(points([80, 90], 60, 150)[1], 60, 76)!;
    expect(a.x).toBe(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
  });

  it('is null with no points rather than anchoring to nothing', () => {
    expect(calloutAnchor(undefined, 350)).toBeNull();
  });
});
