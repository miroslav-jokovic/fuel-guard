import type Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_TOOL_NAMES, type AssistantToolName } from "@silvicom/shared";
import { FINANCE_PERIODS, MAX_FINANCE_TRUCKS } from "../financial/index.js";
import { MAX_REPORT_UNITS, REPORT_PERIODS } from "../fuel-spend/index.js";
import { FLEET_NOW_STATES, MAX_FLEET_NOW_TRUCKS } from "../livemap/index.js";
import { MAX_LOADS_TRUCKS, MAX_LOADS_UNITS } from "../loads/index.js";
import { IFTA_QUARTER_PERIODS } from "../ifta/index.js";

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
      "naming unit numbers, a calendar month/quarter/year or exact dates, FUEL cost per mile, or 'compared with before'. " +
      "All-in cost per mile (every expense, not only fuel) is finance_report's, when this person has that tool. " +
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
  {
    // F21 R6b: the IFTA ledger page's quarter (`ifta/assistantIftaReport.ts`).
    name: "ifta_report",
    description:
      "IFTA for one calendar quarter, from the IFTA ledger page: per state (jurisdiction) the taxable miles, gallons " +
      "burned (miles ÷ the fleet MPG used), gallons bought (cards plus receipts), the rate, tax owed, tax paid at the " +
      "pump and the net; and the quarter's totals. Use for 'IFTA by state', 'what do we owe Texas', or miles per state. " +
      "Default is last quarter. ALWAYS state completeness: months pulled from Samsara (a quarter in progress or a month " +
      "Samsara has not finished is incomplete: give incomplete_note and never call it the return), jurisdictions not " +
      "priced (never tax them at zero), and the fleet MPG verdict and concern (every liability rests on it).",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: [...IFTA_QUARTER_PERIODS], description: "Ignored when year and quarter are given." },
        year: { type: "integer", description: "With quarter." },
        quarter: { type: "integer", description: "1-4, with year." },
        jurisdictions: { type: "array", items: { type: "string" }, description: "Two-letter state or province codes, to list only those." },
      },
    },
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
    description:
      "Raw idle event totals for the last N days: idle hours and the cost of every idle minute, optionally the worst " +
      "idlers by driver or vehicle (set `by`). For the Idling page's figures (avoidable idle, calendar periods, week " +
      "over week, compared with before) use idle_report.",
    input_schema: { type: "object", properties: { by: { type: "string", enum: ["driver", "vehicle"] }, period_days: { type: "integer" }, limit: { type: "integer" } } },
  },
  {
    // F21 R6b: the Idling page's verdict, asked in words (`idle/assistantIdleReport.ts`).
    name: "idle_report",
    description:
      "The Idling page's fleet figures for a calendar period: engine-on, drive and idle hours, idle % of engine-on, " +
      "AVOIDABLE idle hours and cost (trucks with no APU or optimized idle, judged only when observed long enough; the " +
      "page's headline), reducible idle (every covered truck), how many trucks were judged or left out, and the day the " +
      "figures reach through. Always includes the previous period of equal length. by=week gives Monday-to-Sunday " +
      "weeks (week over week); by=month gives calendar months. Use for idling trends, 'this week vs last week', or any " +
      "idle question naming a month, quarter or dates. no_idle_data means nothing was recorded: say so, never estimate.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: [...REPORT_PERIODS], description: "Calendar period on the carrier's clock. Ignored when from/to are given." },
        days: { type: "integer", description: "Only for period=last_n_days (default 30)." },
        from: { type: "string", description: "First day, YYYY-MM-DD (with to)." },
        to: { type: "string", description: "Last day, YYYY-MM-DD, inclusive." },
        by: { type: "string", enum: ["total", "week", "month"] },
      },
    },
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
  // ── Dispatch (F21 R6b, `livemap/assistantFleetNow.ts`; needs the Dispatch module) ──
  {
    name: "fleet_now",
    description:
      "Right now, from the live map: how many trucks are moving, stopped (engine on, not moving), parked or offline, " +
      "how many of each have a driver assigned ('how many drivers are moving'), how many are in the shop, and how many " +
      "trucks have never sent a position. Set state to list those trucks (unit, driver, speed, location, load, next " +
      "stop, position age). Always say the as_of time. The states are the live map's own; never re-judge them from speed.",
    input_schema: {
      type: "object",
      properties: {
        state: { type: "string", enum: [...FLEET_NOW_STATES], description: "List the trucks in this state." },
        limit: { type: "integer", description: `How many trucks to list (at most ${MAX_FLEET_NOW_TRUCKS}).` },
      },
    },
  },
  {
    // F21 R6b: the Loads page's Delivered tab per truck (`loads/assistantLoadsByTruck.ts`).
    name: "loads_by_truck",
    description:
      "Delivered loads per truck for a calendar period, from the Loads page's Delivered tab (a load counts on the day " +
      "the truck left its last delivery stop), with each truck's empty moves and McLeod's dispatched miles for those " +
      "loads. Name units to get those trucks (0 is a real zero for a unit of this fleet); otherwise the trucks with the " +
      "most deliveries. Miles here are McLeod's load miles, NOT measured miles (fuel_report) or billed miles " +
      "(finance_report): say which. Say mcleod_synced_at, and give history_note when present: days before the history " +
      "begins hold no loads, so never call them a zero.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: [...REPORT_PERIODS], description: "Calendar period on the carrier's clock. Ignored when from/to are given." },
        days: { type: "integer", description: "Only for period=last_n_days (default 30)." },
        from: { type: "string", description: "First day, YYYY-MM-DD (with to)." },
        to: { type: "string", description: "Last day, YYYY-MM-DD, inclusive." },
        units: { type: "array", items: { type: "string" }, description: `Unit numbers exactly as the user wrote them (at most ${MAX_LOADS_UNITS}).` },
        limit: { type: "integer", description: `Without units: how many trucks to list (at most ${MAX_LOADS_TRUCKS}).` },
      },
    },
  },
  // ── Finance (F21 R6a, `financial/assistantFinanceReport.ts`; who can open the Fleet report) ──
  {
    name: "finance_report",
    description:
      "The Fleet report from the McLeod ledger, for whole calendar months: ALL-IN revenue, expenses and net, and each " +
      "per measured mile (cost_per_mile here is total operating cost per mile, not fuel only), split into company trucks " +
      "and owner-operators, plus empty miles and expense families (driver pay, fuel, leases, insurance…). Use this for " +
      "'cost per mile', profit, margin, revenue or 'what did a mile cost us'. by=truck gives loads, miles and revenue per " +
      "truck (name units, or get the top trucks by revenue). There is NO per-truck cost or profit: say so, never estimate one. " +
      "by=contractor gives each owner-operator's revenue, pay and margin; by=month splits the period by month. " +
      "ALWAYS state the provenance: which months are in the figures; any month not swept or left out, and why; any month " +
      "still open in McLeod, which can change, so never call it final; and when McLeod was last synced. " +
      "A null per-mile figure is withheld: give per_mile_unavailable_because. Figures equal the Fleet report page.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: [...FINANCE_PERIODS], description: "Calendar period on the carrier's clock (default last_month). Ignored when from/to are given." },
        from: { type: "string", description: "First day, YYYY-MM-DD (with to). Widened to whole months: the ledger is monthly." },
        to: { type: "string", description: "Last day, YYYY-MM-DD, inclusive." },
        by: { type: "string", enum: ["total", "truck", "contractor", "month"] },
        units: { type: "array", items: { type: "string" }, description: "For by=truck: unit numbers exactly as the user wrote them." },
        limit: { type: "integer", description: `For by=truck without units: how many top trucks by revenue (at most ${MAX_FINANCE_TRUCKS}).` },
      },
    },
  },
  {
    name: "income_statement",
    description:
      "The income statement (P&L) from the McLeod ledger for whole calendar months, in the owner's printed statement's " +
      "sections, with a comparison column: the previous period of equal length (default), the fiscal year to date (ytd), " +
      "or none. detail=lines lists every GL account; the default gives section totals. Use for P&L, a line of the " +
      "statement, or 'compared with last month/quarter'. State the provenance exactly as for finance_report.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: [...FINANCE_PERIODS], description: "Calendar period on the carrier's clock (default last_month)." },
        from: { type: "string", description: "First day, YYYY-MM-DD (with to). Widened to whole months." },
        to: { type: "string", description: "Last day, YYYY-MM-DD, inclusive." },
        compare: { type: "string", enum: ["previous", "ytd", "none"] },
        detail: { type: "string", enum: ["sections", "lines"] },
      },
    },
  },
];

/**
 * The definitions this caller's model request carries (F21 R5, D-AI1): exactly `allowed`, in the
 * contract's order so one role's tool block — the start of the cached prefix — is byte-identical from
 * one question to the next. A name in the contract with no definition here, or the reverse, is a test
 * failure (`askTools.test.ts`), so the two lists cannot drift.
 */
export function toolsFor(allowed: readonly AssistantToolName[]): Anthropic.Tool[] {
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  return ASSISTANT_TOOL_NAMES.filter((n) => allowed.includes(n)).map((n) => byName.get(n)!).filter(Boolean);
}
