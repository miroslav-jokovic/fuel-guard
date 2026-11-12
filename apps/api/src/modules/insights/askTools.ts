import type Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_TOOL_NAMES, HIRING_PHASE_LABELS, type AssistantToolName, type AssistantView } from "@silvicom/shared";
import { openViewTool } from "./openAssistantView.js";
import { FINANCE_PERIODS, MAX_FINANCE_TRUCKS } from "../financial/index.js";
import { MAX_REPORT_UNITS, REPORT_PERIODS } from "../fuel-spend/index.js";
import { FLEET_NOW_STATES, MAX_FLEET_NOW_TRUCKS } from "../livemap/index.js";
import { DRIVER_FILE_STATES } from "../evidence/index.js";
import { ANNUAL_DUE_KINDS } from "../maintenance/index.js";
import { RECRUITING_WAITING } from "../recruiting/index.js";
import { MAX_MAINTENANCE_UNITS } from "../fleetpal/index.js";
import { CARD_HOLD_STATUSES } from "../efs/index.js";
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
      "operating cost), reefer fuel, and the previous period of equal length for comparison. Use this for fuel spend, " +
      "gallons or price per gallon (the fuel cards' own figures), and for any fuel question naming unit numbers, a " +
      "calendar month/quarter/year or exact dates, FUEL cost per mile, or 'compared with before'. " +
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
    // F21 R6b: the Fuel cards page's statuses (`efs/assistantCardHolds.ts`).
    name: "card_holds",
    description:
      "Fuel cards on hold or on a FRAUD hold right now, from the Fuel cards page: counts by status, and each held card " +
      "by truck, driver and last four (never a full number), fraud first. Set status to list only Hold or only Fraud. " +
      "Say cards_checked_at (when the cards were last checked with EFS). Cards in no_longer_listed_by_efs show the last " +
      "status EFS reported before it dropped them: never call them held now.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: [...CARD_HOLD_STATUSES] } } },
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
    // F21 R6b: the Drivers page's qualification files (`evidence/assistantDriverFiles.ts`).
    name: "driver_file_expirations",
    description:
      "Driver qualification files (DQF) from the Drivers page: how many files are complete, incomplete or not started, " +
      "how many drivers have each item expired, expiring or missing (CDL, medical card, MVR review, application…), and " +
      "each driver's items, worst first, with the good-until date and days remaining. state narrows to one state; " +
      "drivers names drivers (part of a name is enough). Give as_of_day. Statuses only: never a licence number.",
    input_schema: {
      type: "object",
      properties: {
        state: { type: "string", enum: [...DRIVER_FILE_STATES] },
        drivers: { type: "array", items: { type: "string" }, description: "Driver names, or part of a name." },
      },
    },
  },
  {
    // F21 R6b: the Applicants board (`recruiting/assistantRecruiting.ts`).
    name: "recruiting_counts",
    description:
      "The Applicants board: how many applicants are on it, waiting on us (the office) or on them (the applicant), ready to " +
      "screen, in each stage (Application, Screening, Orientation, Office day, Hire), and how many were declined or withdrew; " +
      "plus applicants longest-waiting first with their stage, who it waits on, the next step and days waiting. " +
      "waiting_on and phase narrow the list. Statuses only: never give a reason for a decision, or anything from an application.",
    input_schema: {
      type: "object",
      properties: {
        waiting_on: { type: "string", enum: [...RECRUITING_WAITING], description: "us = the office, them = the applicant." },
        phase: { type: "string", enum: Object.keys(HIRING_PHASE_LABELS) },
      },
    },
  },
  {
    // F21 R6b: the Shop worklist's annual inspection group (`maintenance/assistantAnnualDue.ts`).
    name: "annual_inspections_due",
    description:
      "Trucks and trailers whose annual (§396.17) inspection is overdue or due within the warning window, from our own " +
      "inspection records: each unit with its expiry date and days remaining, overdue first. kind narrows to trucks or " +
      "trailers. ALWAYS say not_included: a unit with no recorded inspection is not on this list.",
    input_schema: { type: "object", properties: { kind: { type: "string", enum: [...ANNUAL_DUE_KINDS] } } },
  },
  {
    name: "fleet_roster",
    description: "Fleet size right now: total and active counts of vehicles, drivers, and trailers.",
    input_schema: { type: "object", properties: {} },
  },
  {
    // F21 R6b: the truck page's repair bills (`fleetpal/assistantMaintenanceCost.ts`).
    name: "maintenance_cost",
    description:
      "Repair bills for named trucks or trailers over a period (default: the last 12 full months, as the truck page): " +
      "FleetPal's cost per unit with parts, labour, labour hours, services, fees and tax, repairs, days in the shop, " +
      "miles and cost per mile. TWO SOURCES, never mixed: fleetpal_cost includes the shop's own labour, which McLeod " +
      "books as wages; McLeod's maintenance accounts are FLEET-WIDE per month only (mcleod_by_month), with no truck on " +
      "them, so never give a McLeod figure for one unit or divide McLeod by trucks. share_of_ledger_seen_through_fleetpal " +
      "is a lower bound: say 'at least'. If cost_unavailable is present, there is NO figure: give the reason and the months.",
    input_schema: {
      type: "object",
      properties: {
        units: { type: "array", items: { type: "string" }, description: `Truck or trailer unit numbers exactly as written (at most ${MAX_MAINTENANCE_UNITS}).` },
        period: { type: "string", enum: [...REPORT_PERIODS], description: "Calendar period on the carrier's clock. Leave out for the last 12 full months." },
        days: { type: "integer", description: "Only for period=last_n_days." },
        from: { type: "string", description: "First day, YYYY-MM-DD (with to)." },
        to: { type: "string", description: "Last day, YYYY-MM-DD, inclusive." },
      },
      required: ["units"],
    },
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
      "'cost per mile', profit, margin, revenue or 'what did a mile cost us'; NOT for fuel spend, gallons or fuel price, " +
      "which are fuel_report's (the ledger's fuel family is the accounting view, posted late). by=truck gives loads, miles and revenue per " +
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
export function toolsFor(allowed: readonly AssistantToolName[], views: readonly AssistantView[] = []): Anthropic.Tool[] {
  // `open_view`'s definition lists the caller's own pages (F21 Step 5), so it is built per caller; with
  // no page to offer it is left out, whatever `allowed` says. Stable per role, as the cache needs.
  const byName = new Map([...TOOLS, ...(views.length ? [openViewTool(views)] : [])].map((t) => [t.name, t]));
  return ASSISTANT_TOOL_NAMES.filter((n) => allowed.includes(n)).map((n) => byName.get(n)!).filter(Boolean);
}
