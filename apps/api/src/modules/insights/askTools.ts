import type Anthropic from "@anthropic-ai/sdk";
import { MAX_REPORT_UNITS, REPORT_PERIODS } from "../fuel-spend/index.js";

/**
 * The assistant's tool DEFINITIONS — what the model is shown. Their implementations are `runTool` in
 * `askData.ts`. Split out when the `fuel_report` tool (F21 R1) took `askData.ts` past the 500-line
 * budget: the schemas are the model-facing contract and change on a different rhythm from the reads.
 */
// ── Safe, org-scoped query tools. The AI can ONLY call these (never raw SQL), and every query is
// pinned to the caller's org on the server — so it can't reach another tenant's data. Grouped:
// theft/alerts, fuel economics, drivers & idling, and integrity/coverage/fleet. ────────────────────

export const TOOLS: Anthropic.Tool[] = [
  // ── Theft / alerts ──
  {
    name: "fleet_summary",
    description: "Totals for a recent period: fuel spend, gallons, high/critical theft alerts, siphoning events, and suspicious declined attempts.",
    input_schema: { type: "object", properties: { period_days: { type: "integer", description: "Look-back window in days (default 30)" } } },
  },
  {
    name: "top_risk",
    description: "The drivers or vehicles with the most flagged fills in the period, ranked highest-first.",
    input_schema: {
      type: "object",
      properties: { by: { type: "string", enum: ["driver", "vehicle"] }, period_days: { type: "integer" }, limit: { type: "integer", description: "Max rows (default 5)" } },
      required: ["by"],
    },
  },
  {
    name: "odometer_accuracy",
    description: "How accurately drivers (or vehicles) entered odometers vs. the Samsara reading: fills, mismatches (>5 mi), accuracy %, avg/max deviation. Worst first.",
    input_schema: {
      type: "object",
      properties: { by: { type: "string", enum: ["driver", "vehicle"] }, period_days: { type: "integer" }, limit: { type: "integer" } },
      required: ["by"],
    },
  },
  {
    name: "count_signal",
    description: "How many open theft cases in the period contain a given signal. Signals: location_mismatch, tank_space_exceeded, exceeds_tank_capacity, tank_fill_short, cumulative_overfuel, odometer_mismatch, card_multi_vehicle, rapid_repeat_fueling, off_hours_fueling.",
    input_schema: { type: "object", properties: { signal: { type: "string" }, period_days: { type: "integer" } }, required: ["signal"] },
  },
  // ── Fuel economics ──
  {
    // F21 R1: the Fuel Costs report, asked in words (`fuel-spend/assistantFuelReport.ts`).
    name: "fuel_report",
    description:
      "The Fuel Costs report for named trucks and/or calendar periods: fills, gallons, spend, price per gallon, " +
      "fleet MPG measured from odometers over exactly those trucks, miles, FUEL cost per mile (fuel only, not total " +
      "operating cost), reefer fuel, and the previous period of equal length for comparison. Use this for any question " +
      "naming unit numbers, a calendar month/quarter/year or exact dates, cost per mile, or 'compared with before'. " +
      "Figures equal the Fuel Costs page. by=truck gives one row per named unit (default when units are given); " +
      "by=month splits the range by calendar month; by=total gives the combined figure only. If a unit is not found or " +
      "MPG is withheld, say so with the given reason — never estimate.",
    input_schema: {
      type: "object",
      properties: {
        units: { type: "array", items: { type: "string" }, description: `Truck unit numbers exactly as the user wrote them, at most ${MAX_REPORT_UNITS}. Omit for the whole fleet.` },
        period: { type: "string", enum: [...REPORT_PERIODS], description: "Calendar period on the carrier's clock. Ignored when from/to are given." },
        days: { type: "integer", description: "Only for period=last_n_days (default 30)." },
        from: { type: "string", description: "First day, YYYY-MM-DD (with to). Use for a named month, e.g. October 2026 = 2026-10-01..2026-10-31." },
        to: { type: "string", description: "Last day, YYYY-MM-DD, inclusive." },
        by: { type: "string", enum: ["total", "truck", "month"] },
      },
    },
  },
  {
    name: "fuel_economics",
    description: "Fuel economics for a period: number of fills, total gallons, total spend, average price per gallon, fleet MPG (measured odometer miles over the tractor fuel behind them, withheld with a reason when coverage is too thin), and reefer (trailer) fuel spend + gallons.",
    input_schema: { type: "object", properties: { period_days: { type: "integer" } } },
  },
  {
    name: "fuel_ranking",
    description: "Rank drivers, vehicles, or fuel stations by a fuel metric over the period. metric=spend|gallons|mpg. order=desc (highest first, default) or asc (lowest first — e.g. worst MPG). An MPG here is that subject's own figure over its own fills, which is NOT the fleet MPG and must not be compared with it.",
    input_schema: {
      type: "object",
      properties: {
        by: { type: "string", enum: ["driver", "vehicle", "station"] },
        metric: { type: "string", enum: ["spend", "gallons", "mpg"] },
        order: { type: "string", enum: ["desc", "asc"] },
        period_days: { type: "integer" },
        limit: { type: "integer" },
      },
      required: ["by", "metric"],
    },
  },
  {
    name: "spend_trend",
    description: "Fuel spend and gallons bucketed over time (bucket=day or week) for the period — for trend questions like 'is spend going up?'. Fleet MPG is included only at bucket=week: a day's fuel purchases are not that day's consumption, so there is no honest daily MPG.",
    input_schema: { type: "object", properties: { bucket: { type: "string", enum: ["day", "week"] }, period_days: { type: "integer" } } },
  },
  // ── Drivers & idling ──
  {
    name: "driver_performance",
    description: "Driver performance scores over the period, averaged per driver and ranked. metric=safety|efficiency. order=desc (best first, default) or asc (worst first).",
    input_schema: {
      type: "object",
      properties: { metric: { type: "string", enum: ["safety", "efficiency"] }, order: { type: "string", enum: ["desc", "asc"] }, period_days: { type: "integer" }, limit: { type: "integer" } },
    },
  },
  {
    name: "idling_summary",
    description: "Idle totals for the period: idle hours and idle cost. Optionally rank the worst idlers by driver or vehicle (set `by`).",
    input_schema: { type: "object", properties: { by: { type: "string", enum: ["driver", "vehicle"] }, period_days: { type: "integer" }, limit: { type: "integer" } } },
  },
  // ── Integrity, coverage & fleet ──
  {
    name: "declined_summary",
    description: "Declined card attempts in the period, total and broken down by suspicion level (e.g. alert/warn/none).",
    input_schema: { type: "object", properties: { period_days: { type: "integer" } } },
  },
  {
    name: "telematics_coverage",
    description: "What share of fills in the period are corroborated by Samsara telematics: total fills, corroborated fills, and coverage %.",
    input_schema: { type: "object", properties: { period_days: { type: "integer" } } },
  },
  {
    name: "import_activity",
    description: "Recent EFS/report imports in the period: source, kind, filename, status, and row counts (total/inserted/duplicate). Newest first.",
    input_schema: { type: "object", properties: { period_days: { type: "integer" }, limit: { type: "integer" } } },
  },
  {
    name: "fleet_roster",
    description: "Fleet size right now: total and active counts of vehicles, drivers, and trailers.",
    input_schema: { type: "object", properties: {} },
  },
];
