import type { ChartOptions, TooltipItem } from "chart.js";

/**
 * Shared chart look for the dashboard. Colors were validated with the dataviz palette
 * checker against the white card surface (contrast ≥ 3:1, CVD ΔE 93 for the hue pair);
 * severity steps pass adjacent-CVD separation and always render next to labeled counts.
 */
export const viz = {
  /** Fleet MPG (brand accent). */
  indigo: "#4f46e5",
  indigoWash: "rgba(79, 70, 229, 0.08)",
  /** Fuel spend. */
  emerald: "#059669",
  /** Severity scale — ordered, always paired with a visible label + count. */
  severity: {
    critical: "#b91c1c",
    high: "#f97316",
    medium: "#fbbf24",
    low: "#9ca3af",
  },
  grid: "#f3f4f6", // hairline, one step off the white surface
  tick: "#6b7280",
} as const;

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
        backgroundColor: "#111827",
        titleColor: "#f9fafb",
        bodyColor: "#e5e7eb",
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
        border: { color: "#e5e7eb" },
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
