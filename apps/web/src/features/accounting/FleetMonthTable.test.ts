import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import FleetMonthTable from "./FleetMonthTable.vue";
import type { FleetTrendPoint } from "./useFleetTrend";

/**
 * Month by month, mounted (R5). Pinned: newest month first with the month on screen highlighted;
 * a month without a rate prints dashes carrying its reason, never $0.00 or 0.0%; a loss reads red
 * with its bar in the spend hue; the empty share is absent when the API did not send one.
 * `useMediaQuery` is stubbed so DataTable renders a table, not cards.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

const point = (month: string, o: Partial<FleetTrendPoint> = {}): FleetTrendPoint => ({
  month, revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86, miles: 1_552_337, trucks: 172,
  revenuePerMile: 3.11, costPerMile: 2.61, netPerMile: 0.5, reason: null, emptyPct: 10.5, ...o,
});
const short = (month: string) =>
  point(month, { miles: null, trucks: null, revenuePerMile: null, costPerMile: null, netPerMile: null, emptyPct: null, reason: "16 trucks that delivered loads are missing from the miles" });

const mountIt = (points: FleetTrendPoint[], current = "2026-07") => mount(FleetMonthTable, { props: { points, current } });

describe("FleetMonthTable", () => {
  it("lists the months newest first and highlights the month on screen", () => {
    const w = mountIt([point("2026-05"), point("2026-06"), point("2026-07")]);
    const rows = w.findAll("tbody tr");
    expect(rows[0]!.text()).toContain("July 2026");
    expect(rows[2]!.text()).toContain("May 2026");
    expect(rows[0]!.classes().join(" ")).toContain("font-semibold");
    expect(rows[1]!.classes().join(" ")).not.toContain("font-semibold");
  });

  it("prints every figure of a rated month", () => {
    const t = mountIt([point("2026-07")]).text();
    for (const s of ["$4,828,189", "$4,058,143", "$770,046", "1,552,337", "172", "$3.11", "$2.61", "$0.50", "10.5%"]) expect(t).toContain(s);
  });

  it("prints dashes with the reason for a month whose mileage could not support a rate, never zero", () => {
    const w = mountIt([short("2026-02")], "2026-02");
    const row = w.find("tbody tr");
    expect(row.text()).toContain("$4,828,189");
    expect(row.text()).not.toContain("$0.00");
    expect(row.text()).not.toContain("0.0%");
    const dashes = row.findAll("td").filter((td) => td.text() === "—");
    expect(dashes.length).toBe(6);
    expect(row.find('[title*="16 trucks"]').exists()).toBe(true);
  });

  it("reads a loss in red with its bar in the spend hue", () => {
    const w = mountIt([point("2026-01", { revenue: 2_572_980.94, expenses: 2_925_198.58, net: -352_217.64 })], "2026-01");
    const html = w.html();
    expect(html).toContain("bg-caution-500/70");
    expect(html).toContain("text-danger-700");
    expect(w.text()).toContain("-$352,218");
  });

  it("prints a dash for the empty share when the API did not send one", () => {
    const p = point("2026-07");
    delete (p as Partial<FleetTrendPoint>).emptyPct;
    const row = mountIt([p]).find("tbody tr");
    expect(row.findAll("td").at(-1)!.text()).toBe("—");
  });
});
