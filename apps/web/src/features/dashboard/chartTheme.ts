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

/** `resolve()` + alpha, for washes/fills (expects the rgb() form resolve returns). */
export function resolveAlpha(varName: string, alpha: number): string {
  const rgb = resolve(varName);
  const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : rgb;
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
