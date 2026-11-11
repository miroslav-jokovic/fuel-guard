import { beforeEach, describe, expect, it, vi } from "vitest";
import { assistantPreviousRange, assistantWeeksIn, idlingToQuery, type FleetIdleVerdict } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Ask AI's `idle_report` (F21 R6b). Its header promises that every figure is `readFleetIdleVerdict`'s,
 * the Idling page's own verdict, for the days asked, so that reader is a spy recording each window and
 * answering a fixture whose figures cannot be derived from each other (a summed or recomputed figure
 * would differ from the window's own read).
 */
const readFleetIdleVerdict = vi.fn();
vi.mock("./fuelIdleVerdict.js", () => ({ readFleetIdleVerdict: (...a: unknown[]) => readFleetIdleVerdict(...a) }));
const { assistantIdleReport, IDLE_SOURCE } = await import("./assistantIdleReport.js");

const ORG = "org-1";
const NOV_10 = new Date("2026-11-10T15:00:00Z");

/** A verdict tagged by its window so a test can tell which read answered which row. */
const verdict = (from: string, to: string): FleetIdleVerdict =>
  ({
    engineOnH: 1000.5, driveH: 700.25, idleH: 300.25, offH: 0, drivePct: 70, idlePct: 30,
    avoidableH: Number(from.slice(8)) + Number(to.slice(8)) / 100,
    avoidableUsd: 1234.56, reducibleH: 250.5, reducibleUsd: 2000.01, reducibleTrucks: 40,
    confidentTrucks: 31, totalTrucks: 45, rangeDays: 7, thinTrucks: 4, throughDay: to,
    avoidablePricing: { blendedPricePerGal: 3.71, pricedDays: 6, unpricedDays: 1 },
    reduciblePricing: { blendedPricePerGal: 3.71, pricedDays: 6, unpricedDays: 1 },
  }) as FleetIdleVerdict;

const recorder = () => createSupabaseRecorder({ tables: { organizations: [{ operating_hours: { tz: "America/Chicago" } }] } });

beforeEach(() => {
  readFleetIdleVerdict.mockReset();
  readFleetIdleVerdict.mockImplementation((_a: unknown, _o: unknown, from: string, to: string) => Promise.resolve(verdict(from, to)));
});

describe("assistantWeeksIn / assistantPreviousRange — the calendar the tool asks in", () => {
  it("Monday-to-Sunday weeks, clipped to the range", () => {
    // 2026-10-01 is a Thursday; 2026-10-31 a Saturday.
    expect(assistantWeeksIn("2026-10-01", "2026-10-31")).toEqual([
      { from: "2026-10-01", to: "2026-10-04" },
      { from: "2026-10-05", to: "2026-10-11" },
      { from: "2026-10-12", to: "2026-10-18" },
      { from: "2026-10-19", to: "2026-10-25" },
      { from: "2026-10-26", to: "2026-10-31" },
    ]);
  });
  it("the previous window is the same length, ending the day before", () => {
    expect(assistantPreviousRange("2026-10-01", "2026-10-31")).toEqual({ from: "2026-08-31", to: "2026-09-30" });
  });
});

describe("idle_report — the Idling page's verdict for the days asked", () => {
  it("reads the period and the previous one, and copies every figure unchanged", async () => {
    const rec = recorder();
    const out = (await assistantIdleReport(rec.client, ORG, { period: "last_month" }, NOV_10)) as Out;
    expect(readFleetIdleVerdict.mock.calls.map((c) => c.slice(1))).toEqual([
      [ORG, "2026-10-01", "2026-10-31"],
      [ORG, "2026-08-31", "2026-09-30"],
    ]);
    expect(out.source).toBe(IDLE_SOURCE);
    expect(out.total).toEqual({
      from: "2026-10-01", to: "2026-10-31",
      engine_on_hours: 1000.5, drive_hours: 700.25, idle_hours: 300.25, idle_pct_of_engine_on: 30,
      avoidable_idle_hours: 1.31, avoidable_idle_cost: 1234.56, reducible_idle_hours: 250.5, reducible_idle_cost: 2000.01,
      trucks_judged: 31, trucks_total: 45, trucks_left_out_too_little_data: 4, figures_reach_through: "2026-10-31",
      days_priced_at_day_price: 6, days_priced_at_default_basis: 1,
    });
    expect(out.previous_period.avoidable_idle_hours).toBe(31.3);
    expectOrgScoped(rec, ORG);
  });

  it("by=week: one page read per Monday-to-Sunday week, never a sum of days", async () => {
    const out = (await assistantIdleReport(recorder().client, ORG, { from: "2026-10-01", to: "2026-10-18", by: "week" }, NOV_10)) as Out;
    expect(readFleetIdleVerdict.mock.calls.slice(2).map((c) => c.slice(2))).toEqual([
      ["2026-10-01", "2026-10-04"],
      ["2026-10-05", "2026-10-11"],
      ["2026-10-12", "2026-10-18"],
    ]);
    expect(out.by_week.map((w: Out) => w.avoidable_idle_hours)).toEqual([1.04, 5.11, 12.18]);
  });

  it("by=month: calendar months", async () => {
    const out = (await assistantIdleReport(recorder().client, ORG, { period: "last_quarter", by: "month" }, NOV_10)) as Out;
    expect(out.by_month.map((m: Out) => [m.from, m.to])).toEqual([
      ["2026-07-01", "2026-07-31"],
      ["2026-08-01", "2026-08-31"],
      ["2026-09-01", "2026-09-30"],
    ]);
  });

  it("links the Idling page on the answer's whole period, inclusive days, built by its contract", async () => {
    const out = (await assistantIdleReport(recorder().client, ORG, { period: "last_month", by: "week" }, NOV_10)) as Out;
    expect(out.link).toEqual({ surfaceKey: "safety.idling", query: { from: "2026-10-01", to: "2026-10-31" } });
    expect(out.link.query).toEqual(idlingToQuery({ from: "2026-10-01", to: "2026-10-31" }));
  });

  it("says there is no idle data rather than reporting zeros", async () => {
    readFleetIdleVerdict.mockResolvedValue(null);
    const out = (await assistantIdleReport(recorder().client, ORG, { period: "last_month" }, NOV_10)) as Out;
    expect(out.total).toEqual({ from: "2026-10-01", to: "2026-10-31", no_idle_data: true });
  });

  it("refuses more weeks than it reads in one answer", async () => {
    const out = (await assistantIdleReport(recorder().client, ORG, { period: "year_to_date", by: "week" }, NOV_10)) as Out;
    expect(out.error).toMatch(/at most 26 weeks/);
    expect(readFleetIdleVerdict).not.toHaveBeenCalled();
  });
});
