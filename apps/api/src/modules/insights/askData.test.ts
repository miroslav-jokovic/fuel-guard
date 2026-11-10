import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";

/**
 * The assistant loop (F21 R1/R2): its trace for the `ai.ask` audit row and the usage ledger, the request it
 * sends (Haiku 5.5, low effort, a cached prefix that today's date sits after), and how every stop ends.
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
vi.mock("../idle/index.js", () => ({ assistantIdleReport: vi.fn() }));
vi.mock("../ifta/index.js", () => ({ assistantIftaReport: vi.fn(), IFTA_QUARTER_PERIODS: ["this_quarter", "last_quarter"] }));
vi.mock("../fleetpal/index.js", () => ({ assistantMaintenanceCost: vi.fn(), MAX_MAINTENANCE_UNITS: 10 }));
vi.mock("../livemap/index.js", () => ({ assistantFleetNow: vi.fn(), FLEET_NOW_STATES: ["moving"], MAX_FLEET_NOW_TRUCKS: 25 }));
vi.mock("../loads/index.js", () => ({ assistantLoadsByTruck: vi.fn(), MAX_LOADS_TRUCKS: 25, MAX_LOADS_UNITS: 25 }));
vi.mock("../financial/index.js", () => ({
  assistantFinanceReport: vi.fn(),
  assistantIncomeStatement: vi.fn(),
  FINANCE_PERIODS: ["last_month"],
  MAX_FINANCE_TRUCKS: 25,
}));

const { askData } = await import("./askData.js");
const { ASSISTANT_TOOL_NAMES } = await import("@silvicom/shared");
const ALL = ASSISTANT_TOOL_NAMES;
const env = {} as never;
const LATE_OCT_31_CENTRAL = new Date("2026-11-01T03:00:00Z");
const usage = (o: Partial<Record<string, number>> = {}) => ({ input_tokens: 400, output_tokens: 100, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, ...o });
const msg = (content: unknown[], stop_reason = "end_turn", u = usage()) => ({ content, stop_reason, usage: u });
const rec = () => createSupabaseRecorder({ tables: { organizations: [{ operating_hours: { tz: "America/Chicago" } }] } });

beforeEach(() => {
  create.mockReset();
  assistantFuelReport.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("askData", () => {
  it("routes fuel_report to the Fuel Costs report and records each tool, its input, its failure and what every round spent", async () => {
    create
      .mockResolvedValueOnce(msg([{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t1", name: "fuel_report", input: { units: ["748"], period: "last_month" } }], "tool_use", usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 3000 })))
      .mockResolvedValueOnce(msg([{ type: "tool_use", id: "t2", name: "fuel_report", input: { units: ["751"] } }], "tool_use"))
      .mockResolvedValueOnce(msg([{ type: "thinking", thinking: "", signature: "s2" }, { type: "text", text: "Unit 748 ran 6.4 MPG in October." }]));
    assistantFuelReport.mockResolvedValueOnce({ total: { mpg: 6.4 } }).mockRejectedValueOnce(new Error("statement timeout"));

    const out = await askData(rec().client, env, "org-1", "mpg on 748 last month", ALL, LATE_OCT_31_CENTRAL);

    expect(out.answer).toBe("Unit 748 ran 6.4 MPG in October.");
    expect(out.outcome).toBe("answered");
    expect(out.tools).toEqual([
      { name: "fuel_report", input: { units: ["748"], period: "last_month" } },
      { name: "fuel_report", input: { units: ["751"] }, error: "statement timeout" },
    ]);
    expect(out.usage).toMatchObject({ model: "claude-haiku-5-5", rounds: 3, inputTokens: 1200, cacheReadTokens: 6000, cacheWriteTokens: 3000, outputTokens: 300 });
    // 1,200 in × 0.1 + 6,000 read × 0.01 + 3,000 write × 0.125 + 300 out × 0.5 µ$
    expect(out.usage.costMicroUsd).toBeCloseTo(120 + 60 + 375 + 150, 6);
    expect(assistantFuelReport.mock.calls[0]!.slice(1)).toEqual(["org-1", { units: ["748"], period: "last_month" }]);
    // The failed tool goes back to the model marked as an error, not as data.
    const secondRound = create.mock.calls[2]![0].messages.at(-1).content;
    expect(secondRound[0]).toMatchObject({ tool_use_id: "t2", is_error: true });
  });

  it("asks Haiku 5.5 at low effort with the tools and fixed prompt cached, and today's date after the breakpoint", async () => {
    create.mockResolvedValueOnce(msg([{ type: "text", text: "ok" }]));
    await askData(rec().client, env, "org-1", "q", ALL, LATE_OCT_31_CENTRAL);
    const req = create.mock.calls[0]![0];
    expect(req).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 8000, output_config: { effort: "low" }, cache_control: { type: "ephemeral" } });
    expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(req.system[0].text).not.toMatch(/Today is/);
    // 22:00 Central on 10/31 is still 10/31 for the carrier, though UTC has moved to 11/01.
    expect(req.system[1]).toEqual({ type: "text", text: "Today is 2026-10-31 (YYYY-MM-DD) in the carrier's timezone, America/Chicago." });
    expect(req.tools.map((t: { name: string }) => t.name)).toContain("fuel_report");
  });

  it("ends a refusal and a cut-off answer as what they are, never as an answer", async () => {
    create.mockResolvedValueOnce(msg([], "refusal"));
    expect(await askData(rec().client, env, "org-1", "q", ALL)).toMatchObject({ outcome: "refusal", answer: "I can't help with that question." });
    create.mockResolvedValueOnce(msg([{ type: "text", text: "| Unit | MPG |" }], "max_tokens"));
    const cut = await askData(rec().client, env, "org-1", "q", ALL);
    expect(cut.outcome).toBe("max_tokens");
    expect(cut.answer).toMatch(/^\| Unit \| MPG \|\n\n\(The answer was too long and was cut off/);
  });

  it("a model failure ends as `error` and keeps what the earlier rounds spent", async () => {
    create.mockResolvedValueOnce(msg([{ type: "tool_use", id: "t1", name: "fleet_roster", input: {} }], "tool_use")).mockRejectedValueOnce(new Error("overloaded"));
    const out = await askData(createSupabaseRecorder({ tables: { organizations: [], vehicles: { count: 3 }, drivers: { count: 2 }, trailers: { count: 1 } } }).client, env, "org-1", "q", ALL);
    expect(out).toMatchObject({ outcome: "error", usage: { rounds: 1, inputTokens: 400, outputTokens: 100 } });
  });

  it("shows the model only the caller's tools, refuses a call outside them, and strips never-shown fields (R5)", async () => {
    create
      .mockResolvedValueOnce(msg([{ type: "tool_use", id: "t1", name: "fleet_roster", input: {} }, { type: "tool_use", id: "t2", name: "fuel_report", input: {} }], "tool_use"))
      .mockResolvedValueOnce(msg([{ type: "text", text: "done" }]));
    assistantFuelReport.mockResolvedValueOnce({ total: { mpg: 6.4 }, driver: { name: "Ana", ssn: "123-45-6789", card_number: "7083001234567890" } });
    const out = await askData(rec().client, env, "org-1", "q", ["fuel_report"]);
    expect(create.mock.calls[0]![0].tools.map((t: { name: string }) => t.name)).toEqual(["fuel_report"]);
    expect(out.tools).toEqual([
      { name: "fleet_roster", input: {}, error: "That tool is not available with this person's access." },
      { name: "fuel_report", input: {} },
    ]);
    const results = create.mock.calls[1]![0].messages.at(-1).content;
    expect(results[0]).toMatchObject({ tool_use_id: "t1", is_error: true });
    expect(JSON.parse(results[1].content)).toEqual({ total: { mpg: 6.4 }, driver: { name: "Ana" } });
  });

  it("stops at six rounds as `step_limit`", async () => {
    create.mockResolvedValue(msg([{ type: "tool_use", id: "t", name: "fleet_roster", input: {} }], "tool_use"));
    const out = await askData(createSupabaseRecorder({ tables: { organizations: [] } }).client, env, "org-1", "q", ALL);
    expect(out).toMatchObject({ outcome: "step_limit", usage: { rounds: 6 } });
  });
});
