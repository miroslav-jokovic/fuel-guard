import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChartConfiguration } from "chart.js";
import FleetTrendChart from "./FleetTrendChart.vue";
import type { FleetTrendPoint, FleetTrendResponse } from "./useFleetTrend";

/**
 * The trend, mounted (G9). What is pinned is what a reader would be misled BY, which on a chart is
 * never the tooltip copy: a month with no rate must leave a hole in the line rather than a segment
 * drawn between its neighbours, and a month the ledger has not reached must not appear at all.
 *
 * The chart is stubbed at `BaseChart`, so the assertions are against the configuration this
 * component builds — the data Chart.js would draw — rather than against canvas pixels no test can
 * read.
 */

const query = vi.hoisted(() => ({
  data: { value: null as FleetTrendResponse | null },
  isLoading: { value: false },
  isError: { value: false },
  lastArgs: { value: null as unknown },
}));

/**
 * Real refs, built inside the factory. Handing the component plain `{ value }` objects instead
 * makes every one of them truthy in a template, so `v-else-if="isLoading"` is permanently true and
 * the chart is never rendered — the tests then pass or fail for a reason that has nothing to do
 * with the component.
 */
vi.mock("./useFleetTrend", async () => {
  const { ref } = await vi.importActual<typeof import("vue")>("vue");
  return {
    useFleetTrendQuery: (to: { value: string }, months: { value: number }) => {
      query.lastArgs.value = { to: to.value, months: months.value };
      return {
        data: ref(query.data.value),
        isLoading: ref(query.isLoading.value),
        isError: ref(query.isError.value),
      };
    },
  };
});

let config: ChartConfiguration | null = null;
vi.mock("@/components/BaseChart.vue", () => ({
  default: {
    props: ["config", "height"],
    created(this: { config: ChartConfiguration }) {
      config = this.config;
    },
    template: `<div data-testid="chart" />`,
  },
}));

const point = (month: string, o: Partial<FleetTrendPoint> = {}): FleetTrendPoint => ({
  month,
  revenue: 4_000_000,
  expenses: 3_500_000,
  net: 500_000,
  miles: 1_370_444,
  trucks: 149,
  revenuePerMile: 2.92,
  costPerMile: 2.55,
  netPerMile: 0.36,
  reason: null,
  ...o,
});

/** A month whose mileage was short of its fleet: money, no rates, and the reason travelling with it. */
const shortMonth = (month: string) =>
  point(month, {
    miles: null,
    trucks: null,
    revenuePerMile: null,
    costPerMile: null,
    netPerMile: null,
    reason: `Some trucks were not yet sending mileage in ${month} — 16 that carried loads were not measured, so a per-mile figure would read low on miles and high on cost.`,
  });

const respond = (o: Partial<FleetTrendResponse> = {}) => {
  query.data.value = {
    points: [shortMonth("2026-02"), point("2026-03"), point("2026-04", { revenuePerMile: 3.11, costPerMile: 2.61, netPerMile: 0.5 })],
    missing: [],
    rated: 2,
    monthsRequested: ["2026-02", "2026-03", "2026-04"],
    monthsPartial: [],
    ...o,
  };
};

const render = () => mount(FleetTrendChart, { props: { to: "2026-04-30" } });

beforeEach(() => {
  config = null;
  query.isLoading.value = false;
  query.isError.value = false;
  respond();
});

describe("FleetTrendChart", () => {
  it("draws one line each for earned, spent and kept, oldest month first", () => {
    render();
    expect(config!.data.labels).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(config!.data.datasets.map((d) => d.label)).toEqual([
      "Earned per mile",
      "Spent per mile",
      "Kept per mile",
    ]);
    expect(config!.data.datasets[1]!.data).toEqual([null, 2.55, 2.61]);
  });

  /**
   * The whole point of the chart's honesty. February's denominator was short of its fleet, so its
   * rate is null; a line drawn from January to March through that hole invents a shape out of a
   * missing eleven per cent of the trucks.
   */
  it("leaves a hole where a month had no rate rather than drawing through it", () => {
    render();
    for (const dataset of config!.data.datasets) {
      expect(dataset.data[0]).toBeNull();
      expect((dataset as { spanGaps?: boolean }).spanGaps).toBe(false);
    }
  });

  it("gives each line its own colour and names it, so colour is never the only cue", () => {
    render();
    const colors = config!.data.datasets.map((d) => d.borderColor);
    expect(new Set(colors).size).toBe(3);
    // No `series` option: the legend and the index tooltip name the three lines.
    const options = config!.options as { plugins?: { legend?: { display?: boolean } } };
    expect(options.plugins?.legend?.display).toBe(true);
  });

  it("prints the coverage rule's own reason for a month with no rate", () => {
    const w = render();
    expect(w.text()).toContain("16 that carried loads were not measured");
  });

  it("says one reason once, however many months share it", () => {
    respond({ points: [shortMonth("2026-02"), shortMonth("2026-02"), point("2026-03")], rated: 1 });
    const w = render();
    const reason = "16 that carried loads were not measured";
    expect(w.text().split(reason)).toHaveLength(2);
  });

  it("names a month the sweep has not reached instead of leaving its absence unexplained", () => {
    respond({ missing: ["2026-01"] });
    const w = render();
    expect(w.text()).toContain("2026-01");
    expect(config!.data.labels).not.toContain("2026-01");
  });

  it("draws no chart at all when no month in the span can carry a rate", () => {
    respond({ points: [shortMonth("2026-01"), shortMonth("2026-02")], rated: 0 });
    const w = render();
    expect(w.find('[data-testid="chart"]').exists()).toBe(false);
    expect(w.text()).toContain("no rate to plot");
  });

  it("asks for twelve months ending on the period on screen", () => {
    render();
    expect(query.lastArgs.value).toEqual({ to: "2026-04-30", months: 12 });
  });

  it("says so when the trend could not be loaded, rather than showing an empty chart", () => {
    query.isError.value = true;
    const w = render();
    expect(w.find('[data-testid="chart"]').exists()).toBe(false);
    expect(w.text()).toContain("could not be loaded");
  });

  /**
   * A month the sweep reached on the 28th is not a month the sweep has not reached, and the two
   * need different sentences: one waits for a run that has not happened, the other for a re-run of
   * one that has (G11).
   */
  it("separates a month swept mid-month from a month the sweep never reached", () => {
    respond({
      missing: ["2026-01", "2026-08"],
      monthsPartial: [
        { month: "2026-08", periodEnd: "2026-09-01", sweptAt: "2026-08-28 21:02:56.551+00", complete: false, shortfall: "partial" },
      ],
    });
    const w = render();
    expect(w.text()).toContain("swept before the month ended");
    expect(w.text()).toContain("2026-08-28");
    // The "not reached" sentence names January only — August was reached, and too early.
    const notReached = w.text().slice(w.text().indexOf("has not reached"));
    expect(notReached).toContain("2026-01");
    expect(notReached).not.toContain("2026-08");
  });
});
