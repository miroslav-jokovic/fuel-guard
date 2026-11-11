import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ASSISTANT_TOOL_PAGE,
  assistantMonthsIn,
  assistantUnitKey,
  assistantWholeMonths,
  exclusiveEndYmd,
  fleetReportGrainOf,
  fleetReportToQuery,
  type FleetReportTab,
  ledgerMonthWhy,
  organizationTimezone,
  resolveAssistantRange,
  todayInZone,
  type AssistantRangeInput,
  type FleetColumn,
  type FamilyRow,
  type LedgerMonth,
} from "@silvicom/shared";
import { readFinancialSyncedAt } from "../mcleod/index.js";
import { getFleetReport, type FleetReportResult } from "./fleetReport.js";
import { getIncomeStatement, type IncomeStatementResult, type StatementCompare } from "./incomeStatement.js";

/**
 * The assistant's finance tools (F21 R6a, 2026-11-10): the Fleet report and its income statement,
 * asked in words. Each tool declares `accounting: view` in `assistantContract.ts`, the gate of
 * `/fleet-report` and of every `/api/accounting/*` read, so it reaches exactly the people who can
 * open that page: admin, accountant, and the read-only auditor (owner's ruling Q-AI5; the auditor is
 * the matrix's answer, not a list, and is Q-AI11 in F21-ask-ai/PLAN.md §5).
 *
 * ── WHY IT EXISTS, MEASURED ───────────────────────────────────────────────────────────────────────
 * "Cost per mile" was asked twice in production (09/23, 11/02), and it failed both times. The only
 * per-mile tool was `fuel_report`'s FUEL cost per mile, and fuel is about a quarter of what a mile
 * costs this carrier (August 2026: 29.2% of expense, memory finance-lag-is-the-gl-close). The
 * all-in figure is the Fleet report's: the McLeod ledger's whole expense over Samsara's measured
 * miles.
 *
 * ── WHY IT CALLS `getFleetReport` / `getIncomeStatement` AND NOTHING ELSE ────────────────────────
 * Those are the functions behind `GET /api/accounting/fleet-report` and `/income-statement`, the
 * page's own reads, and every rule (the contractor split, the withheld months, a rate withheld when
 * the miles are short) is in `computeFleetReport` / `buildIncomeStatement`, where it is tested.
 * This file copies their fields out and renames them, never adds, divides or rounds. The only
 * things it decides are CALENDAR (which whole months a question is, on the carrier's clock) and
 * NAMES (unit number → the report's `tractor_unit` row).
 *
 * It asks for a period the way the page does. `FleetReportPage.vue` holds the 1st and the LAST day
 * of the period's last month (`lib/reportPeriod.ts`), and its query layer sends the day after as the
 * exclusive `to` every accounting window takes (`exclusiveEnd`, Q-AI10). This sends exactly that
 * (`exclusiveEndYmd`, the same function), so a figure here equals the figure there.
 *
 * ── WHAT EVERY ANSWER CARRIES ────────────────────────────────────────────────────────────────────
 * `provenance`, the facts the page's trust chip and provenance line state (`fleetProvenance.ts`):
 * which months are in the figures, which are missing or were swept before McLeod posted them (and
 * why, in `ledgerMonthWhy`'s words), which are still OPEN in McLeod and can change, and when the
 * McLeod finance sweep last landed. McLeod's GL posts a month 10 to 39 days after it ends, so the
 * likeliest answer to "what did October cost" in early November is "not posted yet". The tool says
 * that instead of a short figure.
 *
 * ORG-SCOPED: the service role bypasses RLS. Both page functions filter `org_id` on every read, and
 * the timezone lookup here does too.
 */

export const FINANCE_PERIODS = ["this_month", "last_month", "this_quarter", "last_quarter", "year_to_date", "last_year"] as const;
/** Per-truck rows returned at most. The Trucks tab lists every tractor; a model answer needs far fewer. */
export const MAX_FINANCE_TRUCKS = 25;
/** `by=month` reads one report per month. A year is the page's own longest step. */
const MAX_MONTHS = 12;
/** Reads in flight at once. Each report reads the staged ledger history; the database is small. */
const CONCURRENCY = 2;

export const FINANCE_SOURCE = "Fleet report (/fleet-report), the same figures that page shows for these months";
export const NO_TRUCK_COST_NOTE =
  "Per-truck rows carry loads, measured miles and revenue only. The Fleet report has no per-truck cost: McLeod " +
  "books leases, insurance and office cost to no truck (D-FLEET1), and the per-truck P&L that would spread them is " +
  "not built yet (TRUCK-DRIVER-PNL-PLAN P3). Never estimate a truck's cost or profit from the fleet's cost per mile.";

export interface AssistantFinanceInput extends AssistantRangeInput {
  units?: unknown;
  by?: unknown;
  limit?: unknown;
  compare?: unknown;
  detail?: unknown;
}

type Period = { ok: true; from: string; to: string; label: string } | { ok: false; error: string };

async function orgToday(admin: SupabaseClient, orgId: string, now: Date): Promise<{ today: string; timezone: string }> {
  const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  const timezone = organizationTimezone((org as { operating_hours?: object | null } | null)?.operating_hours);
  return { today: todayInZone(now, timezone), timezone };
}

/**
 * The question's whole months. `last_n_days` is not offered: the ledger has no day grain, so a
 * 30-day window would be answered with two whole months under a label that said 30 days.
 */
export function resolveFinancePeriod(input: AssistantFinanceInput, today: string): Period {
  const hasDates = typeof input.from === "string" || typeof input.to === "string";
  const preset = (FINANCE_PERIODS as readonly string[]).includes(String(input.period)) ? input.period : "last_month";
  const r = resolveAssistantRange(hasDates ? input : { period: preset }, today);
  if (!r.ok) return r;
  const whole = assistantWholeMonths(r.from, r.to);
  const widened = whole.from !== r.from || whole.to !== r.to;
  return { ok: true, ...whole, label: widened ? `${r.label}, widened to whole months ${whole.from} to ${whole.to}` : r.label };
}

/**
 * F21 R4b (e): the Fleet report opened on THIS answer's whole months — INCLUSIVE, as the page's rail
 * states them; the API's exclusive end (Q-AI10) is `exclusiveEndYmd`'s business, never the link's — on
 * the tab that shows what was asked. Built by the page's contract; `askData` lifts it off before the
 * model sees the result (D-AI8).
 */
function fleetLink(tool: "finance_report" | "income_statement", period: { from: string; to: string }, input: AssistantFinanceInput, tab: FleetReportTab) {
  const aboutTheYear = input.period === "year_to_date" || input.period === "last_year";
  return {
    surfaceKey: ASSISTANT_TOOL_PAGE[tool],
    query: fleetReportToQuery({ grain: fleetReportGrainOf(period.from, period.to, aboutTheYear), from: period.from, to: period.to, tab }),
  };
}

/** The page's provenance facts, verbatim. `sweptAt` is the McLeod finance sweep's last landing. */
function provenance(r: Pick<FleetReportResult, "monthsCovered" | "monthsMissing" | "monthsPartial" | "monthsOpen" | "openNote" | "closeKnown" | "ledgerReason">, sweptAt: string | null) {
  return {
    months_in_figures: r.monthsCovered,
    months_not_swept: r.monthsMissing,
    // Swept before McLeod finished posting them, so left out of every figure (G11), with the reason.
    months_left_out: r.monthsPartial.map((m: LedgerMonth) => ({ month: m.month, why: `${m.month} ${ledgerMonthWhy(m)}` })),
    months_still_open_in_mcleod: r.monthsOpen,
    open_note: r.openNote,
    // False: McLeod's close is unknown, so no month in this answer may be called final.
    mcleod_close_known: r.closeKnown,
    left_out_reason: r.ledgerReason,
    mcleod_last_synced_at: sweptAt,
    mcleod_never_synced: sweptAt === null,
  };
}

const column = (c: FleetColumn) => ({
  trucks: c.trucks,
  measured_miles: c.miles,
  revenue: c.revenue,
  expenses: c.expenses,
  net: c.net,
  revenue_per_mile: c.revenuePerMile,
  cost_per_mile: c.costPerMile,
  net_per_mile: c.netPerMile,
});

const family = (f: FamilyRow) => ({ family: f.label, amount: f.amount, pct_of_revenue: f.pctOfRevenue, per_mile: f.perMile });

/** One report's headline figures: the all-in column, the split, and the per-mile caveat. */
function headline(r: FleetReportResult) {
  return {
    from: r.period.from,
    to: r.period.to,
    all_in: column(r.total),
    company_trucks: column(r.company),
    owner_operators: column(r.ownerOperator),
    per_mile_unavailable_because: r.mileageReason,
    billed_miles: r.billedMiles,
    empty_miles: r.emptyMiles,
    empty_pct: r.emptyPct,
    revenue_per_billed_mile: r.revenuePerBilledMile,
  };
}

async function pool<T, R>(items: readonly T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

/** The `finance_report` tool: all-in cost per mile, the fleet report, per-truck revenue, contractors. */
export async function assistantFinanceReport(
  admin: SupabaseClient,
  orgId: string,
  input: AssistantFinanceInput,
  now: Date = new Date(),
): Promise<unknown> {
  const { today, timezone } = await orgToday(admin, orgId, now);
  const period = resolveFinancePeriod(input, today);
  if (!period.ok) return { error: period.error };
  const months = assistantMonthsIn(period.from, period.to);
  const by = input.by === "month" || input.by === "truck" || input.by === "contractor" ? input.by : "total";
  if (by === "month" && months.length > MAX_MONTHS) return { error: `by=month covers at most ${MAX_MONTHS} months; ${months.length} were asked.` };

  const report = await getFleetReport(admin, orgId, period.from, exclusiveEndYmd(period.to));
  const result: Record<string, unknown> = {
    source: FINANCE_SOURCE,
    timezone,
    period: period.label,
    link: fleetLink("finance_report", period, input, by === "truck" ? "trucks" : by === "contractor" ? "contractors" : "overview"),
    provenance: provenance(report, report.sweptAt),
    ...headline(report),
    expense_families: report.families.expense.map(family),
    revenue_families: report.families.revenue.map(family),
    // Company plus contractors against the ledger; zero by construction (`computeFleetReport`).
    split_ties_to_ledger: report.tieOut.revenue === 0 && report.tieOut.expenses === 0,
  };

  if (by === "truck") {
    const asked = [...new Set((Array.isArray(input.units) ? input.units : []).map(String).filter((u) => assistantUnitKey(u) !== ""))];
    const limit = Math.min(Math.max(Math.trunc(Number(input.limit)) || MAX_FINANCE_TRUCKS, 1), MAX_FINANCE_TRUCKS);
    const rows = report.trucks.map((t) => ({
      unit: t.tractor_unit,
      loads: t.loads,
      measured_miles: t.miles,
      revenue: t.revenue,
      revenue_per_mile: t.revenuePerMile,
      owner_operator: t.isOwnerOperator,
    }));
    if (asked.length) {
      const byKey = new Map(rows.map((r) => [assistantUnitKey(r.unit), r]));
      result.by_truck = asked.map((u) => byKey.get(assistantUnitKey(u))).filter(Boolean);
      // Not on the report is not the same as "not ours": a truck with no booked load is absent too.
      result.units_without_a_row = asked.filter((u) => !byKey.has(assistantUnitKey(u)));
    } else {
      // The page's own order is the shared builder's; the answer takes the top by revenue, stated.
      result.by_truck = [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
      result.by_truck_note = `Top ${limit} of ${rows.length} trucks by revenue.`;
    }
    result.per_truck_cost = NO_TRUCK_COST_NOTE;
  } else if (by === "contractor") {
    result.by_contractor = report.ownerOperators.map((o) => ({
      payee: o.payeeId,
      units: o.units,
      settlements: o.settlements,
      revenue: o.revenue,
      pay: o.pay,
      gross_margin: o.grossMargin,
      deduction_income: o.deductionIncome,
      net_margin: o.netMargin,
      deal_pct: o.dealPct,
    }));
  } else if (by === "month" && months.length > 1) {
    const per = await pool(months, (m) => getFleetReport(admin, orgId, m.from, exclusiveEndYmd(m.to)));
    result.by_month = per.map((r) => ({ ...headline(r), months_in_figures: r.monthsCovered, months_still_open_in_mcleod: r.monthsOpen }));
  }
  return result;
}

/** The `income_statement` tool: the ledger as the owner's printed P&L reads it, with a comparison. */
export async function assistantIncomeStatement(
  admin: SupabaseClient,
  orgId: string,
  input: AssistantFinanceInput,
  now: Date = new Date(),
): Promise<unknown> {
  const { today, timezone } = await orgToday(admin, orgId, now);
  const period = resolveFinancePeriod(input, today);
  if (!period.ok) return { error: period.error };
  const compare: StatementCompare = input.compare === "ytd" || input.compare === "none" ? input.compare : "previous";
  const lines = input.detail === "lines";

  const [s, sweptAt]: [IncomeStatementResult, string | null] = await Promise.all([
    getIncomeStatement(admin, orgId, period.from, exclusiveEndYmd(period.to), compare),
    readFinancialSyncedAt(admin, orgId),
  ]);
  return {
    source: "Income statement (/fleet-report, Income statement tab), the same figures that tab shows for these months",
    timezone,
    period: period.label,
    link: fleetLink("income_statement", period, input, "statement"),
    provenance: provenance(s, sweptAt),
    comparison: {
      kind: s.comparison.kind,
      from: s.comparison.from,
      to_exclusive: s.comparison.to,
      months_in_figures: s.comparison.monthsCovered,
      months_not_swept: s.comparison.monthsMissing,
    },
    revenue: s.revenue,
    expenses: s.expenses,
    net: s.net,
    comparison_revenue: s.toDateRevenue,
    comparison_expenses: s.toDateExpenses,
    comparison_net: s.toDateNet,
    unrecognised_net: s.unrecognisedNet,
    sections: s.sections.map((sec) => ({
      section: sec.label,
      is_revenue: sec.isRevenue,
      total: sec.total,
      comparison_total: sec.toDateTotal,
      ...(lines
        ? { lines: sec.lines.map((l) => ({ glid: l.glid, account: l.descr, amount: l.amount, pct_of_revenue: l.pctOfRevenue, comparison_amount: l.toDateAmount })) }
        : { accounts: sec.lines.length }),
    })),
  };
}
