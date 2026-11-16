import { describe, expect, it, vi } from "vitest";
import type { Chart } from "chart.js";
import { barValueLabels, valueBand } from "./chartMarks";

/**
 * The Fleet MPG card's two marks (SMALL-SCREENS-PLAN.md D-SM13), driven with a stand-in chart: only
 * the geometry these plugins read, and a context that records what they draw.
 */
function fakeChart(bars: { x: number; y: number }[], data: (number | null)[], width: number) {
  const ctx = { save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), fillRect: vi.fn(), font: "", textAlign: "", textBaseline: "", fillStyle: "" };
  const chart = {
    ctx,
    chartArea: { left: 40, right: 40 + width, width },
    data: { datasets: [{ data }] },
    getDatasetMeta: () => ({ data: bars }),
    scales: { y: { getPixelForValue: (v: number) => 200 - v * 20 } },
  };
  return { chart: chart as unknown as Chart<"bar">, ctx };
}

describe("barValueLabels", () => {
  it("writes each measured week's figure over its bar and skips a week with none", () => {
    const { chart, ctx } = fakeChart([{ x: 60, y: 70 }, { x: 120, y: 80 }, { x: 180, y: 200 }], [6.62, 6.96, null], 240);
    barValueLabels((v) => v.toFixed(1)).afterDatasetsDraw!(chart, {} as never, {} as never, {} as never);
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toEqual(["6.6", "7.0"]);
  });

  it("writes nothing when a bar's slot is too narrow for a figure, rather than over its neighbour", () => {
    // Thirteen weeks in a 290 px phone plot: 22 px a slot.
    const bars = Array.from({ length: 13 }, (_, i) => ({ x: 40 + i * 22, y: 70 }));
    const { chart, ctx } = fakeChart(bars, bars.map(() => 6.8), 290);
    barValueLabels((v) => v.toFixed(1)).afterDatasetsDraw!(chart, {} as never, {} as never, {} as never);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});

describe("valueBand", () => {
  it("fills the plot's width between the band's two values", () => {
    const { chart, ctx } = fakeChart([], [], 300);
    valueBand.beforeDatasetsDraw!(chart, {} as never, { band: { lo: 7, hi: 7.5 } });
    // y(7.5) = 50, y(7) = 60.
    expect(ctx.fillRect).toHaveBeenCalledWith(40, 50, 300, 10);
  });

  it("draws nothing when there is no band", () => {
    const { chart, ctx } = fakeChart([], [], 300);
    valueBand.beforeDatasetsDraw!(chart, {} as never, { band: null });
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
