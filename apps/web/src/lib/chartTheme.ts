import type { ChartOptions, TooltipItem } from "chart.js";

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
export function areaFill(varName: string) {
  const top = resolveAlpha(varName, 0.3);
  const mid = resolveAlpha(varName, 0.08);
  const bottom = resolveAlpha(varName, 0);
  return (context: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
    const area = context.chart.chartArea;
    if (!area) return mid;
    const g = context.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, top);
    g.addColorStop(0.55, mid);
    g.addColorStop(1, bottom);
    return g;
  };
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
}: TrendOptionArgs): ChartOptions<"line" | "bar"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      // A single series is named by the card title; several must name themselves.
      legend: {
        display: series === undefined,
        position: "bottom",
        labels: { color: viz.tick, font: FONT, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 16 },
      },
      tooltip: {
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
        grid: { color: viz.grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: viz.tick,
          font: FONT,
          padding: 8,
          maxTicksLimit: 5,
          callback: (value) => tickFormat(Number(value)),
        },
      },
    },
  };
}
