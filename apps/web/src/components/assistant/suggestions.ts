import { surfaceForPath, type AssistantToolName } from "@silvicom/shared";

/**
 * What the assistant offers to answer, chosen by the page the reader is on (F21 redesign).
 *
 * ⚠ Every question here must be one the assistant's tools CAN answer today — and since R5, one THIS
 * person's tools can answer (each names its tool; `suggestionsFor` filters). The tools are
 * still fuel-shaped (`modules/insights/askTools.ts`: spend, MPG, rankings, the Fuel Costs report for
 * named trucks and calendar periods, theft cases, idling, driver scores, declines, telematics
 * coverage, imports, roster counts) plus, since R6a, the Fleet report and income statement for
 * whoever can open that page. Offering a dispatcher
 * "which loads are late?" before a loads tool exists would be a button that produces an apology.
 * When Step 4 of the plan adds a section's tools, that section's questions are added here with them.
 *
 * Keyed by the surface the page belongs to (`surfaceForPath`, the same catalogue the sidebar reads),
 * so a detail page asks about its parent's subject. A page with nothing specific gets the general
 * set — which is also the order the reader sees on `/ask` itself.
 */

type Suggestion = { q: string; tool: AssistantToolName };
const ask = (q: string, tool: AssistantToolName): Suggestion => ({ q, tool });

const GENERAL: Suggestion[] = [
  ask("How much did we spend on fuel last month, and what's our fleet MPG?", "fuel_report"),
  ask("Which drivers have the worst MPG this quarter?", "fuel_ranking"),
  ask("How many high or critical theft alerts in the last 30 days?", "fleet_summary"),
  ask("Idle hours and cost this month — who are the worst idlers?", "idling_summary"),
  ask("How many trucks, trailers and drivers are active right now?", "fleet_roster"),
  ask("How many drivers are moving right now?", "fleet_now"),
];

const BY_SURFACE: Record<string, Suggestion[]> = {
  "fuel.log": [
    // F21 Step 5: a navigation, filtering this page behind the dock (`open_view`, view `fuel_log`).
    ask("Show me the high-risk declines from the last 7 days", "open_view"),
    ask("Top 5 fuel stations by spend in the last 30 days", "fuel_ranking"),
    ask("Fuel spend and MPG by month this year so far", "fuel_report"),
    ask("Is fuel spend going up week by week this quarter?", "spend_trend"),
    ask("What's our average price per gallon this month?", "fuel_economics"),
  ],
  "fuel.spend": [
    ask("Fuel cost per mile last quarter, compared with the quarter before", "fuel_report"),
    ask("Fuel spend and MPG for each month of last quarter", "fuel_report"),
    ask("Is fuel spend going up week by week this quarter?", "spend_trend"),
    ask("Which trucks spent the most on fuel last month?", "fuel_ranking"),
    ask("How much did we spend on reefer fuel this month?", "fuel_economics"),
  ],
  "fuel.ifta": [
    ask("IFTA by state last quarter: miles, gallons and tax owed", "ifta_report"),
    ask("What do we owe Texas for IFTA this quarter so far?", "ifta_report"),
  ],
  "fuel.cards": [
    ask("Which fuel cards are on hold or on a fraud hold right now?", "card_holds"),
    ask("How many declined card attempts this month, and how many look suspicious?", "declined_summary"),
    ask("Which drivers have the most flagged fills this month?", "top_risk"),
  ],
  "fuel.exceptions": [
    ask("Which drivers have the most flagged fills this month?", "top_risk"),
    ask("How many open cases have a location mismatch?", "count_signal"),
  ],
  "safety.alerts": [
    ask("How many high or critical theft alerts in the last 30 days?", "fleet_summary"),
    ask("Which trucks have the most flagged fills this month?", "top_risk"),
    ask("How many open cases show a fill bigger than the tank?", "count_signal"),
  ],
  "safety.idling": [
    ask("Avoidable idling week by week over the last 8 weeks", "idle_report"),
    ask("Avoidable idle cost last month compared with the month before", "idle_report"),
    ask("Idle hours and cost this month — who are the worst idlers?", "idling_summary"),
    ask("Which trucks idled the most in the last 2 weeks?", "idling_summary"),
  ],
  "safety.driver-performance": [
    ask("Best and worst drivers by safety score this month", "driver_performance"),
    ask("Who has the lowest efficiency score this quarter?", "driver_performance"),
  ],
  "fleet.odometer": [
    ask("Which drivers enter odometers least accurately?", "odometer_accuracy"),
    ask("What % of our fills are corroborated by telematics?", "telematics_coverage"),
  ],
  // F21 R6a: the finance tools (`accounting: view`: admin, accountant, auditor); a person without
  // them never sees these (`suggestionsFor` filters by tool).
  "finance.fleet-report": [
    ask("What was our all-in cost per mile last month?", "finance_report"),
    ask("Revenue, expenses and net last quarter, company trucks versus owner-operators", "finance_report"),
    ask("Which trucks earned the most revenue last month?", "finance_report"),
    ask("Income statement last month compared with the month before", "income_statement"),
  ],
  "dispatch.loads": [
    ask("How many loads did each truck deliver last month?", "loads_by_truck"),
    ask("Loads delivered and miles for units 748 and 751 this month", "loads_by_truck"),
  ],
  "maintenance.inspections": [ask("Which trucks and trailers are due for their annual inspection?", "annual_inspections_due")],
  "maintenance.repair-spend": [ask("Which annual inspections are overdue or due this month?", "annual_inspections_due")],
  "maintenance.units": [
    ask("Which trucks and trailers are due for their annual inspection?", "annual_inspections_due"),
    ask("What did trucks 748 and 751 cost in repairs over the last 12 months?", "maintenance_cost"),
    ask("Repair cost per mile for truck 748 this year", "maintenance_cost"),
  ],
  "recruitment.applicants": [
    ask("How many applicants are waiting on us, and who has waited longest?", "recruiting_counts"),
    ask("How many applicants are in each stage right now?", "recruiting_counts"),
  ],
  "fleet.vehicles": [ask("How many trucks, trailers and drivers are active right now?", "fleet_roster")],
  "fleet.drivers": [
    ask("Which drivers have an expired or expiring CDL or medical card?", "driver_file_expirations"),
    ask("How many drivers are active right now?", "fleet_roster"),
    ask("Best and worst drivers by safety score this month", "driver_performance"),
  ],
};

/**
 * Up to `n` questions: the page's own first, then the general set, never the same one twice — and only
 * questions this person's tools can answer (F21 R5, D-AI1): each suggestion names the tool it needs, and
 * `tools` is `assistantToolsFor(role, sections)`, the list the endpoint itself will use.
 */
export function suggestionsFor(path: string, tools: readonly AssistantToolName[], n = 4): string[] {
  const s = surfaceForPath(path);
  const key = s?.parent ?? s?.key ?? "";
  const own = BY_SURFACE[key] ?? [];
  const usable = [...own, ...GENERAL].filter((x) => tools.includes(x.tool)).map((x) => x.q);
  return [...new Set(usable)].slice(0, n);
}
