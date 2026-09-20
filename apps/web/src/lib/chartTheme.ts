import type { ChartOptions, TooltipItem } from "chart.js";
import { niceScale } from "./niceScale";

/**
 * Shared chart look, driven by the design tokens in
 * src/style.css. Canvas can't read CSS variables, so `resolve()` computes
 * each --viz-* role at first use (cached; charts mount after styles load).
 * Hex fallbacks keep unit tests (jsdom) rendering.
 *
 * NOT necessarily an rgb() string, whatever this comment used to claim: the
 * tokens are authored in oklch(), and Chrome returns `oklch(0.596 0.128 163)`
 * from getComputedStyle rather than resolving it to rgb. `resolveAlpha` case 3
 * is what handles that, and it is the reason it exists.
 *
 * scripts/check-chart-colors.mjs verifies contrast and pairwise separation
 * under protan, deutan, and tritan simulation. Color is never the only cue:
 * severity values also have direct labels and semantic table fallbacks.
 *
 * It lives in `lib/` rather than under `features/dashboard/`, where it was
 * written, because a feature may not import a sibling feature's internals
 * (lint:boundaries) and the finance trend (G9) is the second feature to need
 * this palette. The alternative was a second copy of the resolver, which is
 * how one product ends up with two chart looks and no way to change either.
 */
const FALLBACK: Record<string, string> = {
  "--viz-brand": "#955cad",
  "--viz-spend": "#019669",
  "--viz-spend-hover": "#017857",
  "--viz-severity-critical": "#9f0712",
  "--viz-severity-high": "#7610e4",
  "--viz-severity-medium": "#aa530a",
  "--viz-severity-low": "#4f5763",
  "--viz-cost-moving": "#019669",
  "--viz-cost-idle": "#ba2f12",
  "--viz-cost-reefer": "#1d4ed8",
  "--viz-money-earned": "#3b6fe0",
  "--viz-money-spent": "#d9603f",
  "--viz-money-kept": "#1a9f74",
  "--viz-grid": "#eef0f3",
  "--viz-tick": "#64636e",
  "--surface": "#ffffff",
  "--surface-inverse": "#1c1c1f",
  "--ink-inverse": "#ffffff",
  "--edge-subtle": "#ededf0",
  "--edge": "#e4e4e7",
  "--ramp-neutral-50": "#fafbfc",
  "--ramp-neutral-200": "#dcdfe3",
};

const cache = new Map<string, string>();

/** Resolve a CSS custom property to a concrete rgb() color for canvas use. */
export function resolve(varName: string): string {
  const hit = cache.get(varName);
  if (hit) return hit;
  const fallback = FALLBACK[varName] ?? "#000000";
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("span");
  probe.style.color = `var(${varName}, ${fallback})`;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color || fallback;
  probe.remove();
  cache.set(varName, value);
  return value;
}

/** #rgb / #rrggbb -> channels. */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * `resolve()` + alpha, for washes/fills. Canvas needs a color it can parse WITH an alpha, so we add the
 * alpha in whatever form the browser serialized the base color — getting this wrong collapses every alpha
 * to the opaque color and turns gradient fills solid, so it is unit-tested. Handles, in order:
 *   1. a hex (plain, or the `var(--x, #hex)` string jsdom returns unresolved) -> rgba() channels
 *   2. `rgb()/rgba()` with commas OR spaces (CSS Color 4, what Chrome 2024+ returns) -> rgba() channels
 *   3. any other CSS color function (oklch/oklab/hsl/lab/color()) -> the Color-4 `<fn>(… / alpha)` form
 *   4. fallback: this role's known hex constant -> rgba()
 */
export function resolveAlpha(varName: string, alpha: number): string {
  const c = resolve(varName).trim();
  const hex = c.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
  if (hex) {
    const rgb = hexToRgb(hex[0]);
    if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }
  if (/^rgba?\(/i.test(c)) {
    const nums = c.match(/-?\d*\.?\d+/g);
    if (nums && nums.length >= 3) return `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alpha})`;
  }
  const fn = c.match(/^([a-z]+)\((.+)\)$/i);
  if (fn) {
    const name = fn[1] ?? "";
    const inner = ((fn[2] ?? "").split("/")[0] ?? "").trim();
    return `${name}(${inner} / ${alpha})`;
  }
  const fbHex = FALLBACK[varName];
  const fb = fbHex ? hexToRgb(fbHex) : null;
  return fb ? `rgba(${fb.r}, ${fb.g}, ${fb.b}, ${alpha})` : c;
}

/** Chart color roles (getters so tokens resolve lazily, post-mount). */
export const viz = {
  /** Fleet MPG (brand accent). */
  get brand(): string {
    return resolve("--viz-brand");
  },
  get brandWash(): string {
    return resolveAlpha("--viz-brand", 0.08);
  },
  /** Fuel spend. */
  get spend(): string {
    return resolve("--viz-spend");
  },
  get spendHover(): string {
    return resolve("--viz-spend-hover");
  },
  /** Soft fill under the spend area line. */
  get spendWash(): string {
    return resolveAlpha("--viz-spend", 0.12);
  },
  /** Severity scale — ordered, always paired with a visible label + count. */
  get severity(): Record<"critical" | "high" | "medium" | "low", string> {
    return {
      critical: resolve("--viz-severity-critical"),
      high: resolve("--viz-severity-high"),
      medium: resolve("--viz-severity-medium"),
      low: resolve("--viz-severity-low"),
    };
  },
  get grid(): string {
    return resolve("--viz-grid"); // hairline, one step off the white surface
  },
  get tick(): string {
    return resolve("--viz-tick");
  },
  /** Muted line for baseline/reference series. */
  get reference(): string {
    return resolve("--viz-severity-low");
  },
  /** Contrasting stroke around hovered points (matches the card surface). */
  get pointHalo(): string {
    return resolve("--ink-inverse");
  },
};

/**
 * Cost-composition slices (Moving fuel / Idle waste / Reefer). These resolve the canonical visualization
 * roles so canvas and the visible legend stay in sync. The palette checker verifies white-surface contrast
 * and protan/deutan/tritan separation; direct labels and the table fallback mean color is never the only cue.
 */
export const COST_COLORS = {
  get moving(): string {
    return resolve("--viz-cost-moving");
  },
  get idle(): string {
    return resolve("--viz-cost-idle");
  },
  get reefer(): string {
    return resolve("--viz-cost-reefer");
  },
};

/**
 * The fleet report's three lines — earned, spent and kept per mile (G9).
 *
 * They deliberately carry the cost palette's own hues: that trio is already verified for pairwise
 * separation under protan, deutan and tritan simulation, and three lines on one chart need that
 * verification more than a single-series card does. `check-chart-colors.mjs` validates this palette
 * by name, so the reuse cannot quietly stop being true. Colour is not the only cue — every line is
 * named in the legend and in the index tooltip, which lists all three at once.
 */
export const MONEY_COLORS = {
  get earned(): string {
    return resolve("--viz-money-earned");
  },
  get spent(): string {
    return resolve("--viz-money-spent");
  },
  get kept(): string {
    return resolve("--viz-money-kept");
  },
};

/**
 * Scriptable Chart.js fill: a vertical gradient from the series color (soft at the top) fading to
 * transparent at the baseline — the modern "area under the line" look. Falls back to a flat wash before
 * the chart area is laid out (and under jsdom, where canvas gradients are unavailable), so it never throws.
 */
export interface AreaFillOptions {
  /** Opacity at the top of the plot area. */
  top?: number;
  /** Opacity at `midAt`. */
  mid?: number;
  /** Where (0–1 of the plot height) the fill reaches `mid`. */
  midAt?: number;
  /** Where (0–1 of the plot height) the fill has faded to nothing; 1 is the baseline. */
  fadeAt?: number;
}

/**
 * The defaults draw the wash to the baseline. A chart with several lines gives every series but
 * the headline one an early `fadeAt` — the fleet trend fades earned and spent out within the top
 * third — so three washes never overlap into a band nobody can read (D-FRUI7).
 *
 * ── THE DEFAULTS WERE HALVED AT DR3, AND THE NUMBER CAME OFF THE COMP ────────────────────────────
 * Sampled out of comp (3)'s Fleet MPG card, 2026-09-16 (`docs/design examples/…11_08_55 PM (3)`),
 * reading the PNG a pixel at a time rather than looking at it: the wash is `rgba` ≈ 0.047 directly
 * under the line, still 0.047 at 59% of the plot height, 0.026 at 71% and 0.012 at 95%. The old
 * defaults compute to 0.128 / 0.077 / 0.052 / 0.009 at those same depths — a little over twice the
 * comp everywhere but the very bottom. `top` 0.3 → 0.14 and `mid` 0.08 → 0.045 reproduce the comp
 * to within a couple of hundredths across the whole band.
 *
 * ⚠ `FleetTrendChart` is NOT affected and that is deliberate rather than lucky: all three of its
 * series pass an explicit wash, including the headline one, which spells out the old defaults
 * in full. D-FRUI7's three-wash tuning survives untouched.
 */
export function areaFill(varName: string, { top = 0.14, mid = 0.045, midAt = 0.55, fadeAt = 1 }: AreaFillOptions = {}) {
  const topColor = resolveAlpha(varName, top);
  const midColor = resolveAlpha(varName, mid);
  const bottom = resolveAlpha(varName, 0);
  return (context: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
    const area = context.chart.chartArea;
    if (!area) return midColor;
    const g = context.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, topColor);
    g.addColorStop(Math.min(midAt, fadeAt), midColor);
    g.addColorStop(fadeAt, bottom);
    if (fadeAt < 1) g.addColorStop(1, bottom);
    return g;
  };
}

/**
 * The bar geometry the comps draw (DR3, DESIGN-REFRESH-2026-09.md §3).
 *
 * Both dashboard comps render "Fuel spend · daily total across the fleet" as BARS, and measured off
 * comp (3): a bar is 9–10px wide with a 1–2px gap, so it fills ~85% of its band, and its top corners
 * carry an arc that drops 2px over about 3 — a radius of roughly a third of the bar's width. The
 * bottom corners are square, sitting on the axis.
 *
 * `borderSkipped: "bottom"` is what keeps them square: Chart.js rounds every corner NOT adjacent to
 * the skipped edge, so without it a bar floats on four rounded corners and stops reading as a
 * quantity standing on a baseline.
 *
 * `maxBarThickness` exists because this dashboard's range is an arbitrary from/to, not a menu of
 * fixed windows: a seven-day range across a 900px card would otherwise draw 120px slabs, where a
 * 4px radius reads as square and the chart reads as a diagram of nothing.
 *
 * Exported as one object rather than spelled out at the call site so the second bar chart is a
 * second reference and not a second set of five numbers.
 */
export const BAR_GEOMETRY = {
  borderRadius: 4,
  borderSkipped: "bottom" as const,
  maxBarThickness: 28,
  categoryPercentage: 0.95,
  barPercentage: 0.9,
};

/**
 * A dot on the LAST point only, which is where a trend's value is read (D-FRUI7's R5 ruling).
 *
 * ⚠ Comp (3) appears to put a dot on every point and does not: measured 2026-09-16, the MPG line is
 * a uniform 1–3 dark pixels per column for its whole length and 4 only at the final point. What
 * reads as a row of dots in an upscaled screenshot is the antialiasing of a 2px stroke. The comp and
 * the existing ruling agree, and only counting pixels showed it — the same lesson as D-DR17.
 *
 * `FleetTrendChart` had this inline for three series; it is here so a fourth caller reuses the
 * decision instead of the number.
 */
export function lastPointRadius(lastIndex: number, radius = 4) {
  return (ctx: { dataIndex: number }) => (ctx.dataIndex === lastIndex ? radius : 0);
}

const FONT = {
  family: "'Hanken Grotesk', system-ui, sans-serif",
  size: 11,
};

/** "2026-07-04" → "Jul 4" (labels arrive pre-bucketed in the org timezone). */
export function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "2026-07" → "Jul 2026". Month labels arrive as the ledger's own period keys. */
export function fmtMonth(key: string): string {
  const d = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** Compact display for large stat values; the exact figure stays in the tooltip/title. */
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 100_000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  }
  return Math.round(n).toLocaleString();
}

interface TrendOptionArgs {
  /** Format a y value for the tooltip body. */
  format: (value: number) => string;
  /** Axis-tick formatting when it should differ from the tooltip (defaults to `format`). */
  tickFormat?: (value: number) => string;
  /**
   * Series name shown in the tooltip body — for a chart with ONE line, which the card title names.
   *
   * Omit it for a multi-line chart: each point is then named by its own dataset label and the
   * legend appears, because a reader cannot be asked to tell three lines apart by colour alone.
   */
  series?: string;
  /** Bars/spend anchor at zero; rate-like series (MPG) read better zoomed to their range. */
  beginAtZero?: boolean;
  /** How an x label is written out (defaults to `fmtDay`; monthly series pass `fmtMonth`). */
  labelFormat?: (raw: string) => string;
  /**
   * The series' own maximum, for a "nice" y axis (D-DT12, `lib/niceScale.ts`).
   *
   * Handed in rather than read off the chart because options are built from the data anyway and the
   * caller already has it. Omit it and the axis is Chart.js's own division of the range, which is
   * what drew `$15.3K / $30.7K / $46K` on the spend card. Ignored unless `beginAtZero`: a rate-like
   * series is zoomed to its range and a ladder anchored at zero says nothing about it.
   */
  dataMax?: number;
  /**
   * D-DT11 — the readout IS the tooltip. Called with the point under the pointer, and with `null`
   * when the pointer leaves, so the card's header can show the value being pointed at in the same
   * slot and the same type as the period total. Passing it SUPPRESSES the floating tooltip: two
   * readings of one number, one of them following the cursor, is the thing this replaces.
   */
  onScrub?: (point: { label: string; value: number } | null) => void;
}

/**
 * Base options for the two time-trend charts: recessive hairline grid, muted ticks,
 * a crosshair-style index tooltip (hover anywhere on the x — no pixel hunting).
 */
export function trendOptions({
  format,
  tickFormat = format,
  series,
  beginAtZero = true,
  labelFormat = fmtDay,
  dataMax,
  onScrub,
}: TrendOptionArgs): ChartOptions<"line" | "bar"> {
  const nice = beginAtZero && dataMax !== undefined ? niceScale(dataMax) : undefined;
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    /**
     * ⚠ Reads the ELEMENTS Chart.js hands it, not the pointer position. With `mode: "index"` the
     * array holds one element per dataset at the nearest x, so `[0]` is the point under the
     * pointer on a single-series card; an empty array is the pointer leaving the plot, which has
     * to reach the header as `null` or the readout freezes on the last value it saw.
     */
    onHover: onScrub
      ? (_event, elements, chart) => {
          const hit = elements[0];
          if (!hit) return onScrub(null);
          const label = String(chart.data.labels?.[hit.index] ?? "");
          const value = Number(chart.data.datasets[hit.datasetIndex]?.data[hit.index] ?? Number.NaN);
          onScrub(Number.isFinite(value) ? { label, value } : null);
        }
      : undefined,
    plugins: {
      // A single series is named by the card title; several must name themselves.
      legend: {
        display: series === undefined,
        position: "bottom",
        labels: { color: viz.tick, font: FONT, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 16 },
      },
      tooltip: {
        // Off when the header is doing the job (D-DT11): the number you are pointing at belongs in
        // the big type, not in a box beside the cursor repeating it.
        enabled: onScrub === undefined,
        backgroundColor: resolve("--surface-inverse"),
        titleColor: resolve("--ramp-neutral-50"),
        bodyColor: resolve("--ramp-neutral-200"),
        titleFont: { ...FONT, size: 12, weight: 600 },
        bodyFont: { ...FONT, size: 12 },
        padding: 10,
        cornerRadius: 8,
        displayColors: series === undefined,
        callbacks: {
          title: (items: TooltipItem<"line" | "bar">[]) =>
            items.length ? labelFormat(String(items[0]!.label)) : "",
          label: (item: TooltipItem<"line" | "bar">) => {
            const name = series ?? item.dataset.label ?? "";
            return item.parsed.y == null ? `${name}: no data` : `${name}: ${format(item.parsed.y)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: resolve("--edge") },
        ticks: {
          color: viz.tick,
          font: FONT,
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 7,
          callback(value) {
            const label = this.getLabelForValue(Number(value));
            return labelFormat(label);
          },
        },
      },
      y: {
        beginAtZero,
        // The nice ladder decides the top of the axis as well as the gap, so the last gridline is
        // the axis maximum rather than a step past the data (D-DT12).
        max: nice?.max,
        grid: { color: viz.grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: viz.tick,
          font: FONT,
          padding: 8,
          maxTicksLimit: 5,
          stepSize: nice?.stepSize,
          callback: (value) => tickFormat(Number(value)),
        },
      },
    },
  };
}
