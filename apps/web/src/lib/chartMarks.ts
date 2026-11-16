import type { Chart, Plugin } from "chart.js";
import { resolve, resolveAlpha } from "./chartTheme";

/**
 * Two marks a bar chart needs and Chart.js does not draw: a value written over each bar, and a band
 * behind the bars for "where last period sat" (SMALL-SCREENS-PLAN.md D-SM13, the Fleet MPG card).
 *
 * Both are plain Chart.js plugins passed in a chart's own `plugins: [...]`, never registered
 * globally: a global plugin runs on every chart in the app, and the next chart would grow labels
 * nobody asked it for.
 *
 * ── WHY THE VALUE IS WRITTEN ON THE BAR ────────────────────────────────────────────────────────
 * MPG bars start at zero, because a bar's length IS its value and a bar cut off at 5 MPG makes 6.2
 * look like half of 6.8. From zero, a fleet's weeks differ by a few percent of the bar, which is the
 * truth about a fleet's MPG and also too little to read off a length. So the number is printed, and
 * the length only says "about the same". The label is dropped when the slot is too narrow for it
 * (a long range on a phone) rather than drawn over its neighbour; hovering still shows it.
 */

const LABEL_FONT = "600 11px 'Hanken Grotesk', system-ui, sans-serif";
/** The narrowest bar slot "6.6" fits over with air either side — measured, 11px semibold is ~18px. */
const MIN_SLOT_FOR_LABEL = 26;

export function barValueLabels(format: (v: number) => string): Plugin<"bar"> {
  return {
    id: "barValueLabels",
    afterDatasetsDraw(chart: Chart<"bar">) {
      const meta = chart.getDatasetMeta(0);
      const data = chart.data.datasets[0]?.data ?? [];
      if (!meta?.data.length) return;
      const slot = chart.chartArea.width / meta.data.length;
      if (slot < MIN_SLOT_FOR_LABEL) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = LABEL_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = resolve("--ink-secondary");
      meta.data.forEach((bar, i) => {
        const v = data[i];
        if (typeof v !== "number") return;
        ctx.fillText(format(v), bar.x, bar.y - 4);
      });
      ctx.restore();
    },
  };
}

/**
 * A horizontal band across the plot between two values, drawn BEHIND the bars.
 *
 * ⚠ The band is read from the chart's OPTIONS (`options.plugins.valueBand.band`), never closed over.
 * `BaseChart` builds a chart once and then updates its data and options in place, and Chart.js keeps
 * the plugin list it was built with: a band captured when the first frame drew — before the previous
 * period's read had answered, so null — stayed null for the life of the chart. Found in the browser
 * pass on 2026-11-16, where the legend named a band the plot did not draw.
 */
export interface ValueBandOptions {
  band: { lo: number; hi: number } | null;
}

export const valueBand: Plugin<"bar", ValueBandOptions> = {
  id: "valueBand",
  beforeDatasetsDraw(chart: Chart<"bar">, _args, opts: ValueBandOptions) {
    const band = opts?.band;
    if (!band) return;
    const y = chart.scales.y;
    if (!y) return;
    const { left, right } = chart.chartArea;
    const top = y.getPixelForValue(band.hi);
    // A band whose lowest and highest week are equal is still a place; give it a line's height.
    const height = Math.max(2, y.getPixelForValue(band.lo) - top);
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = resolveAlpha("--ramp-neutral-500", 0.14);
    ctx.fillRect(left, top, right - left, height);
    ctx.restore();
  },
};
