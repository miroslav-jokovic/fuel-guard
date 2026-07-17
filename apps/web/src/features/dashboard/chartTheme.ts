import type { ChartOptions, TooltipItem } from "chart.js";

/**
 * Shared chart look for the dashboard, driven by the design tokens in
 * src/style.css. Canvas can't read CSS variables, so `resolve()` computes
 * each --viz-* role to an rgb() string at first use (cached; charts mount
 * after styles load). Hex fallbacks keep unit tests (jsdom) rendering.
 *
 * Colors were validated with the dataviz palette checker against the white
 * card surface (contrast ≥ 3:1, CVD ΔE 93 for the hue pair); severity steps
 * pass adjacent-CVD separation and always render next to labeled counts.
 */
const FALLBACK: Record<string, string> = {
  "--viz-brand": "#4f46e5",
  "--viz-spend": "#059669",
  "--viz-spend-hover": "#047857",
  "--viz-severity-critical": "#b91c1c",
  "--viz-severity-high": "#f97316",
  "--viz-severity-medium": "#fbbf24",
  "--viz-severity-low": "#9ca3af",
  "--viz-grid": "#f3f4f6",
  "--viz-tick": "#6b7280",
  "--surface-inverse": "#111827",
  "--ink-inverse": "#ffffff",
  "--edge": "#e5e7eb",
  "--ramp-neutral-50": "#f9fafb",
  "--ramp-neutral-200": "#e5e7eb",
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
 * Cost-composition slices (Moving fuel / Idle waste / Reefer). Fixed hex, validated with the dataviz
 * palette checker against the card surface: all three PASS lightness, chroma, CVD separation
 * (worst adjacent deltaE 9.4) and >= 3:1 contrast; always shown with direct labels + a table fallback.
 */
export const COST_COLORS = { moving: "#059669", idle: "#c2410c", reefer: "#4338ca" } as const;

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

function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : hex;
}

/**
 * Per-slice radial gradient for a doughnut: each arc fades from a soft translucent inner edge to the
 * solid color at the rim — the modern "transparent" ring. Falls back to the flat color before layout
 * (and under jsdom). `hexColors` are the slice hexes, index-aligned to the dataset.
 */
export function donutGradient(hexColors: string[]) {
  return (context: {
    chart: { ctx: CanvasRenderingContext2D; chartArea?: { left: number; right: number; top: number; bottom: number } };
    dataIndex: number;
  }) => {
    const color = hexColors[context.dataIndex] ?? hexColors[0] ?? "#000000";
    const area = context.chart.chartArea;
    if (!area) return color;
    const cx = (area.left + area.right) / 2;
    const cy = (area.top + area.bottom) / 2;
    const r = Math.min(area.right - area.left, area.bottom - area.top) / 2;
    const g = context.chart.ctx.createRadialGradient(cx, cy, Math.max(0, r * 0.62), cx, cy, r);
    g.addColorStop(0, hexToRgba(color, 0.5));
    g.addColorStop(1, color);
    return g;
  };
}

const FONT = {
  family:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  size: 11,
};

/** "2026-07-04" → "Jul 4" (labels arrive pre-bucketed in the org timezone). */
export function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  /** Series name shown in the tooltip body. */
  series: string;
  /** Bars/spend anchor at zero; rate-like series (MPG) read better zoomed to their range. */
  beginAtZero?: boolean;
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
}: TrendOptionArgs): ChartOptions<"line" | "bar"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false }, // single series — the card title names it
      tooltip: {
        backgroundColor: resolve("--surface-inverse"),
        titleColor: resolve("--ramp-neutral-50"),
        bodyColor: resolve("--ramp-neutral-200"),
        titleFont: { ...FONT, size: 12, weight: 600 },
        bodyFont: { ...FONT, size: 12 },
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          title: (items: TooltipItem<"line" | "bar">[]) =>
            items.length ? fmtDay(String(items[0]!.label)) : "",
          label: (item: TooltipItem<"line" | "bar">) =>
            item.parsed.y == null ? `${series}: no data` : `${series}: ${format(item.parsed.y)}`,
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
            return fmtDay(label);
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
