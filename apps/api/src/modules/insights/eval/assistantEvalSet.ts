import type { AssistantHistoryTurn, AssistantToolName, UserRole } from "@silvicom/shared";

/**
 * Ask AI's eval set (F21 R7, PLAN Step 1c): the questions people really asked, and one per tool the
 * reporting track added, each with what a right answer must do. `pnpm --filter @silvicom/api
 * eval:assistant` asks them of the real model; it is never run in CI (it costs money and reads a
 * carrier's data).
 *
 * ── WHERE THE QUESTIONS COME FROM ────────────────────────────────────────────────────────────────
 * `real`: every distinct question in production's `ai.ask` audit rows, 2026-07-02 to 2026-11-10
 * (21 asks, 11 distinct), copied exactly, typos included, because those are how the office types.
 * `tool`: one question per R6 tool, worded the way the suggestions on its page word it, so each
 * tool is asked at least once. `role`: a question the person's access must REFUSE.
 *
 * ── WHAT IS JUDGED, AND WHAT IS NOT ──────────────────────────────────────────────────────────────
 * Each tool's figure equals its page's by construction and by its own tests (the page's function,
 * spied). So the eval does not re-check numbers. It judges the one thing only the model decides:
 * which tool it picks, with what input, and whether the answer says what the tool told it to say
 * (provenance, a refusal). `expectTools` is "any of": a question two tools can honestly answer lists
 * both.
 */

export interface AssistantEvalCase {
  id: string;
  kind: "real" | "tool" | "role";
  question: string;
  /** Who asks: the tools are `assistantToolsFor(role, null, every module)`, as the endpoint gives them. */
  role: UserRole;
  /** Any one of these, called without error, passes. Empty = the answer must call NO tool. */
  expectTools: AssistantToolName[];
  /** For the first matching call: each key's value must equal, or (arrays) contain every listed item. */
  expectInput?: Record<string, unknown>;
  /** Every pattern must match the answer text. */
  mustMention?: RegExp[];
  /** Earlier turns, for a follow-up (R3a). */
  history?: AssistantHistoryTurn[];
  /** Where it came from: the production day, or the tool it exercises. */
  source: string;
}

export const ASSISTANT_EVAL_SET: AssistantEvalCase[] = [
  // ── real: production `ai.ask`, 2026-07-02 → 2026-11-10 ──
  { id: "theft-alerts-30d", kind: "real", role: "admin", source: "2026-07-02 (×3)", question: "How many high or critical theft alerts in the last 30 days?", expectTools: ["fleet_summary", "count_signal"] },
  { id: "flagged-fills-drivers", kind: "real", role: "admin", source: "2026-07-02", question: "Which drivers had the most flagged fills this month?", expectTools: ["top_risk"] },
  { id: "idle-2-weeks-trend", kind: "real", role: "admin", source: "2026-07-29", question: "can you check based on our data is idling lower in last 2 weeks, and does it follow less idling trend", expectTools: ["idle_report"] },
  { id: "idle-3-weeks-by-week", kind: "real", role: "admin", source: "2026-08-04", question: "how much idling has lower or higher comparing last 3 weeks, week by week in percantage", expectTools: ["idle_report"], expectInput: { by: "week" } },
  { id: "worst-mpg-drivers-q", kind: "real", role: "admin", source: "2026-08-14 (×4)", question: "Which drivers have the worst MPG this quarter?", expectTools: ["fuel_ranking", "fuel_report"] },
  { id: "spend-and-mpg-last-month", kind: "real", role: "admin", source: "2026-09-15 (×4)", question: "How much did we spend on fuel last month, and what's our fleet MPG?", expectTools: ["fuel_report", "fuel_economics"] },
  { id: "top-stations", kind: "real", role: "admin", source: "2026-09-15 (×2)", question: "Top 5 fuel stations by spend in the last 30 days.", expectTools: ["fuel_ranking"], expectInput: { by: "station", metric: "spend" } },
  { id: "worst-idlers-month", kind: "real", role: "admin", source: "2026-09-16", question: "Idle hours and cost this month — who are the worst idlers?", expectTools: ["idling_summary", "idle_report"] },
  // "cost per mile" (×2) is all-in: the Fleet report's, and it must say which months are in it.
  { id: "cost-per-mile", kind: "real", role: "admin", source: "2026-09-23, 2026-11-02", question: "cost per mile", expectTools: ["finance_report"], mustMention: [/month|McLeod/i] },
  { id: "drivers-moving", kind: "real", role: "admin", source: "2026-10-09", question: "how many drivers is moving at moment", expectTools: ["fleet_now"] },
  { id: "mpg-nine-units", kind: "real", role: "admin", source: "2026-11-09", question: "can you check for me my mpg on my units 748 751 762 763 784 785 786 787 788 Lets say for month or Q if can", expectTools: ["fuel_report"], expectInput: { units: ["748", "751", "762", "763", "784", "785", "786", "787", "788"] } },

  // ── tool: one per R6 tool, as its page's suggestion asks it ──
  { id: "loads-per-truck", kind: "tool", role: "dispatcher", source: "loads_by_truck", question: "How many loads did each truck deliver last month?", expectTools: ["loads_by_truck"], mustMention: [/McLeod|miles/i] },
  { id: "ifta-by-state", kind: "tool", role: "accountant", source: "ifta_report", question: "IFTA by state last quarter: miles, gallons and tax owed", expectTools: ["ifta_report"] },
  { id: "repair-bills", kind: "tool", role: "technician", source: "maintenance_cost", question: "What did trucks 748 and 751 cost in repairs over the last 12 months?", expectTools: ["maintenance_cost"], expectInput: { units: ["748", "751"] } },
  { id: "card-holds", kind: "tool", role: "fleet_manager", source: "card_holds", question: "Which fuel cards are on hold or on a fraud hold right now?", expectTools: ["card_holds"] },
  // F21 Step 5: a navigation, not a figure. The model must open the page, not read and recite a list.
  { id: "show-open-fuel-problems", kind: "tool", role: "fleet_manager", source: "open_view", question: "Show me the open fuel problems for unit 718", expectTools: ["open_view"], expectInput: { view: "fuel_problems" } },
  // Step 5's acceptance question, answerable since Q-AI14 (a) gave the page a minimum amount.
  { id: "show-findings-over-200", kind: "tool", role: "fleet_manager", source: "open_view", question: "Show me open findings over $200 for unit 718", expectTools: ["open_view"], expectInput: { view: "fuel_problems" } },
  { id: "show-declines-fuel-log", kind: "tool", role: "dispatcher", source: "open_view", question: "Show me the declined card swipes for unit 718 in the last 7 days", expectTools: ["open_view"], expectInput: { view: "fuel_log" } },
  { id: "show-critical-alerts", kind: "tool", role: "safety_manager", source: "open_view", question: "Show me the critical fuel alerts for unit 718", expectTools: ["open_view"], expectInput: { view: "fuel_alerts" } },
  { id: "show-cards-with-override", kind: "tool", role: "fleet_manager", source: "open_view", question: "Show me the fuel cards that have an active override", expectTools: ["open_view"], expectInput: { view: "fuel_cards" } },
  { id: "show-medical-due-drivers", kind: "tool", role: "safety_manager", source: "open_view", question: "Show me the drivers whose medical card is due in the next 30 days", expectTools: ["open_view"], expectInput: { view: "drivers" } },
  { id: "dq-expiring", kind: "tool", role: "safety_manager", source: "driver_file_expirations", question: "Which drivers have an expired or expiring CDL or medical card?", expectTools: ["driver_file_expirations"] },
  { id: "annual-due", kind: "tool", role: "technician", source: "annual_inspections_due", question: "Which trucks and trailers are due for their annual inspection?", expectTools: ["annual_inspections_due"] },
  { id: "applicants-waiting", kind: "tool", role: "recruiter", source: "recruiting_counts", question: "How many applicants are waiting on us, and who has waited longest?", expectTools: ["recruiting_counts"] },
  { id: "income-statement", kind: "tool", role: "accountant", source: "income_statement", question: "Income statement last month compared with the month before", expectTools: ["income_statement"] },
  { id: "idle-cost-vs-before", kind: "tool", role: "safety_manager", source: "idle_report", question: "Avoidable idle cost last month compared with the month before", expectTools: ["idle_report"] },
  {
    id: "follow-up-month-before", kind: "tool", role: "admin", source: "R3a follow-up",
    history: [{ question: "How much did we spend on fuel last month?", answer: "Fuel spend in October 2026 was $412,380 over 108,900 gallons." }],
    question: "and the month before?", expectTools: ["fuel_report", "fuel_economics"],
  },

  // ── role: the access must refuse, and the answer must say so rather than guess ──
  { id: "recruiter-no-fuel", kind: "role", role: "recruiter", source: "D-AI1", question: "How much did we spend on fuel last month?", expectTools: [], mustMention: [/can.?t|cannot|not able|access|don.?t have/i] },
  { id: "dispatcher-no-finance", kind: "role", role: "dispatcher", source: "Q-AI5", question: "What was our net profit last month?", expectTools: [], mustMention: [/can.?t|cannot|not able|access|don.?t have/i] },
];
