/**
 * The eight-week trend line's geometry, kept pure so the domain rule and the path can be tested.
 *
 * A chart is the easiest place in an app to be confidently wrong: a domain that starts at zero
 * flattens every real difference into noise, and one that starts at the minimum exaggerates a
 * two-point wobble into a cliff. The rule below is the compromise, written down and pinned.
 */
export interface ChartPoint {
  x: number;
  y: number;
  value: number;
  index: number;
}

/**
 * Scores live in the 60–100 band in practice, so a 0–100 axis wastes two thirds of the height and
 * makes every week look identical. The floor is the ten below the lowest week, clamped at 0, and
 * the ceiling is always 100 — the grade has a real maximum and hiding it would flatter the driver.
 */
export function domain(values: readonly number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 100 };
  const lowest = Math.min(...values);
  return { min: Math.max(0, Math.floor((lowest - 5) / 10) * 10), max: 100 };
}

/** Gridlines every ten from the floor, the ceiling included. */
export function gridlines(values: readonly number[]): number[] {
  const { min, max } = domain(values);
  const out: number[] = [];
  for (let v = min; v <= max; v += 10) out.push(v);
  return out;
}

export function points(
  values: readonly number[],
  width: number,
  height: number,
  padding = { left: 26, right: 10, top: 8, bottom: 18 },
): ChartPoint[] {
  const { min, max } = domain(values);
  const span = max - min || 1;
  const innerW = Math.max(1, width - padding.left - padding.right);
  const innerH = Math.max(1, height - padding.top - padding.bottom);
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;

  return values.map((value, index) => ({
    index,
    value,
    x: padding.left + (values.length > 1 ? index * step : innerW / 2),
    y: padding.top + (1 - (value - min) / span) * innerH,
  }));
}

/**
 * A Catmull-Rom spline converted to cubic béziers: it passes THROUGH every week rather than near it,
 * which matters because each point is a real grade a driver can look up. A smoothing that misses its
 * own data points would be a drawing of the trend, not the trend.
 */
export function smoothPath(pts: readonly ChartPoint[], tension = 6): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${round(pts[0]!.x)} ${round(pts[0]!.y)}`;

  let d = `M ${round(pts[0]!.x)} ${round(pts[0]!.y)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / tension;
    const c1y = p1.y + (p2.y - p0.y) / tension;
    const c2x = p2.x - (p3.x - p1.x) / tension;
    const c2y = p2.y - (p3.y - p1.y) / tension;
    d += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(p2.x)} ${round(p2.y)}`;
  }
  return d;
}

/** The filled area under the line, closed along the baseline. */
export function areaPath(pts: readonly ChartPoint[], height: number, bottomPadding = 18): string {
  if (pts.length < 2) return '';
  const base = height - bottomPadding;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return `${smoothPath(pts)} L ${round(last.x)} ${round(base)} L ${round(first.x)} ${round(base)} Z`;
}

/**
 * Where the callout sits. It hangs above-left of the newest point, and is clamped inside the chart
 * so the one number a driver came to read never runs off the edge — which is exactly what happens
 * on the last point of a right-anchored series if nothing clamps it.
 */
export function calloutAnchor(
  last: ChartPoint | undefined,
  width: number,
  calloutWidth = 76,
  calloutHeight = 38,
): { x: number; y: number } | null {
  if (!last) return null;
  const x = Math.min(Math.max(0, last.x - calloutWidth + 8), Math.max(0, width - calloutWidth));
  const y = Math.max(0, last.y - calloutHeight - 8);
  return { x, y };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
