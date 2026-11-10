import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";

/**
 * The assistant loop's trace (F21 R1, AUDIT P3/P4): what the `ai.ask` audit row keeps beside the
 * question, and the date the model is told — "last month" means nothing to a model that does not know
 * what today is on the carrier's clock.
 */
const create = vi.fn();
vi.mock("../../lib/anthropic.js", () => ({ anthropicClient: () => ({ messages: { create } }) }));
const assistantFuelReport = vi.fn();
vi.mock("../fuel-spend/index.js", () => ({
  assistantFuelReport: (...a: unknown[]) => assistantFuelReport(...a),
  getFleetMpg: vi.fn(),
  getFleetMpgSeries: vi.fn(),
  MAX_REPORT_UNITS: 25,
  REPORT_PERIODS: ["last_month"],
}));
vi.mock("../fuel/index.js", () => ({ FUEL_EVENT_DROP: "drop" }));

const { askData } = await import("./askData.js");
const env = {} as never;

describe("askData", () => {
  it("routes fuel_report to the Fuel Costs report and records each tool, its input and its failure", async () => {
    create.mockReset();
    create
      .mockResolvedValueOnce({ content: [{ type: "tool_use", id: "t1", name: "fuel_report", input: { units: ["748"], period: "last_month" } }] })
      .mockResolvedValueOnce({ content: [{ type: "tool_use", id: "t2", name: "fuel_report", input: { units: ["751"] } }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: "Unit 748 ran 6.4 MPG in October." }] });
    assistantFuelReport.mockResolvedValueOnce({ total: { mpg: 6.4 } }).mockRejectedValueOnce(new Error("statement timeout"));
    const rec = createSupabaseRecorder({ tables: { organizations: [{ operating_hours: { tz: "America/Chicago" } }] } });

    const out = await askData(rec.client, env, "org-1", "mpg on 748 last month", new Date("2026-11-01T03:00:00Z"));

    expect(out).toEqual({
      answer: "Unit 748 ran 6.4 MPG in October.",
      tools: [
        { name: "fuel_report", input: { units: ["748"], period: "last_month" } },
        { name: "fuel_report", input: { units: ["751"] }, error: "statement timeout" },
      ],
    });
    expect(assistantFuelReport.mock.calls[0]!.slice(1)).toEqual(["org-1", { units: ["748"], period: "last_month" }]);
    // 22:00 Central on 10/31 is still 10/31 for the carrier, though UTC has moved to 11/01.
    expect(create.mock.calls[0]![0].system).toContain("Today is 2026-10-31 (YYYY-MM-DD) in the carrier's timezone, America/Chicago.");
    expect(create.mock.calls[0]![0].tools.map((t: { name: string }) => t.name)).toContain("fuel_report");
  });
});
