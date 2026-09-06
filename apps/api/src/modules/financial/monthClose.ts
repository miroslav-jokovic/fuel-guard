import type { SupabaseClient } from "@supabase/supabase-js";
import { planMonthClose, type MonthClosePlan } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { readSweptMonths, readFinancialSyncedAt } from "../mcleod/index.js";
import { notify } from "../messaging/index.js";
import { getGlIncomeForMonths } from "./glIncome.js";
import { getLedgerCoverage } from "./ledgerCoverage.js";
import { officeUserIds } from "./officeRecipients.js";

/**
 * The monthly close (D-FIN14, FINANCE-GO-LIVE-PLAN §1.14): for every (company, month) the GL sweep
 * has landed and that is at least two months old, read the month's ledger totals and the per-module
 * ledger coverage as of the sweep's stamp, and persist the money, the residuals and the verdict on
 * `finance_month_closes`. "Hardened" is `planMonthClose`'s word, given only when every residual
 * reads 0.00; the row carries the reasons when it is not.
 *
 * **Restated at G7b (owner ruling 2026-09-04).** This used to call `computeCpmForWindow` and prove
 * that the per-truck report's allocation buckets added back to the ledger. Nothing allocates now
 * (D-FLEET8), and the fleet report asserts its own decomposition on EVERY request — it refuses to
 * build a report where company + contractors ≠ ledger — so proving it again once a month proved
 * something already guaranteed, while making this the last live caller of an apparatus the product
 * had stopped reading. The close now reads the ledger directly and proves the one thing only it
 * can: whether the sweeps landed the whole month.
 *
 * Recomputed whenever the GL sweep for that month is newer than the close (the first-of-month
 * hardening pass, D-FIN4, re-reads the two previous months whole), and never otherwise — a close
 * is a fact about a moment. A hardened month whose figures move on a later sweep becomes a
 * finding in the office inbox (the D-FIN3 fabric), never a silent update.
 *
 * Lives in `financial` because only `financial` may read the collector's staging (D-SEP1) and
 * because the collector must never import the harness: the close runs from the financial
 * freshness scheduler, not from the ingest route.
 */
export interface MonthCloseRow {
  org_id: string;
  company_id: string;
  period_start: string;
  period_end: string;
  swept_at: string | null;
  computed_at: string;
  gl_revenue: number;
  gl_expenses: number;
  settlement_drift: number | null;
  billing_drift: number | null;
  fuel_residual: number | null;
  status: MonthClosePlan["status"];
  open_reasons: string[];
}

const round = (n: number) => Math.round(n * 100) / 100 + 0;

/** Compute one close. Pure over its two reads; nothing is written here. */
export async function computeMonthClose(
  admin: SupabaseClient,
  orgId: string,
  companyId: string,
  periodStart: string,
  periodEnd: string,
  sweptAt: string | null,
  now: Date,
): Promise<MonthCloseRow> {
  const [glIncome, coverage] = await Promise.all([
    // The same read the income statement's own totals come from, so a stored close and the page a
    // reader opens beside it cannot disagree about what the month booked.
    getGlIncomeForMonths(admin, orgId, [
      { year: Number(periodStart.slice(0, 4)), month: Number(periodStart.slice(5, 7)) },
    ]),
    getLedgerCoverage(admin, orgId, periodStart, periodEnd),
  ]);
  const drift = (module: string): number | null => {
    const m = coverage.modules.find((x: { post_module: string }) => x.post_module === module);
    return m && m.drift != null ? round(m.drift) : null;
  };
  const inputs = {
    periodStart,
    now,
    glRevenue: round(glIncome.revenue),
    glExpenses: round(glIncome.expenses),
    settlementDrift: drift("SET"),
    billingDrift: drift("BILL"),
    // The FUEL claim's drift is the decomposition's whole-month residual (D-FIN12).
    fuelResidual: drift("FUEL"),
  };
  const plan = planMonthClose(inputs);
  return {
    org_id: orgId,
    company_id: companyId,
    period_start: periodStart,
    period_end: periodEnd,
    swept_at: sweptAt,
    computed_at: now.toISOString(),
    gl_revenue: inputs.glRevenue,
    gl_expenses: inputs.glExpenses,
    settlement_drift: inputs.settlementDrift,
    billing_drift: inputs.billingDrift,
    fuel_residual: inputs.fuelResidual,
    status: plan.status,
    open_reasons: plan.openReasons,
  };
}

interface StoredClose {
  company_id: string;
  period_start: string;
  swept_at: string | null;
  status: string;
  gl_revenue: number | string;
  gl_expenses: number | string;
}

/** Every close the org holds, newest month first — the Books check page's table. */
export async function getMonthCloses(admin: SupabaseClient, orgId: string): Promise<MonthCloseRow[]> {
  const { data, error } = await admin
    .from("finance_month_closes")
    .select("*")
    .eq("org_id", orgId)
    .order("period_start", { ascending: false })
    .order("company_id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MonthCloseRow[];
}

/**
 * One pass for one org: every swept (company, month) whose sweep is newer than its close is
 * recomputed. Returns the rows written. A hardened month whose GL figures moved is reported.
 */
export async function runMonthClosesOnce(
  admin: SupabaseClient,
  _env: Env,
  orgId: string,
  now: Date = new Date(),
): Promise<MonthCloseRow[]> {
  const [swept, existingRes, financialSweptAt] = await Promise.all([
    readSweptMonths(admin, orgId),
    admin
      .from("finance_month_closes")
      .select("company_id, period_start, swept_at, status, gl_revenue, gl_expenses")
      .eq("org_id", orgId),
    readFinancialSyncedAt(admin, orgId),
  ]);
  if (existingRes.error) throw new Error(existingRes.error.message);
  const existing = (existingRes.data ?? []) as StoredClose[];
  const stored = new Map(existing.map((c) => [`${c.company_id}|${c.period_start}`, c]));
  const written: MonthCloseRow[] = [];
  const changedHardened: string[] = [];

  for (const m of swept) {
    const companyId = m.company_id ?? "TMS"; // pre-0303 rows carry no company; production's are TMS (0303 header)
    const prior = stored.get(`${companyId}|${m.period_start}`);
    // A close is a fact about a sweep: recompute only when a newer sweep landed for that month.
    if (prior?.swept_at && prior.swept_at >= m.swept_at) continue;
    const row = await computeMonthClose(admin, orgId, companyId, m.period_start, m.period_end, financialSweptAt ?? m.swept_at, now);
    const { error } = await admin.from("finance_month_closes").upsert(row, { onConflict: "org_id,company_id,period_start" });
    if (error) throw new Error(`finance_month_closes upsert failed: ${error.message}`);
    written.push(row);
    if (
      prior?.status === "hardened" &&
      (round(Number(prior.gl_revenue)) !== row.gl_revenue || round(Number(prior.gl_expenses)) !== row.gl_expenses || row.status !== "hardened")
    ) {
      changedHardened.push(`${m.period_start.slice(0, 7)} (${companyId})`);
    }
  }

  if (changedHardened.length) {
    const day = now.toISOString().slice(0, 10);
    for (const userId of await officeUserIds(admin, orgId)) {
      await notify(admin, {
        orgId,
        userId,
        category: "system",
        title: `A hardened month changed: ${changedHardened.join(", ")}`,
        body: "A later McLeod sweep moved the figures of a month that had tied to the cent. The close is recomputed and the month is open again until it ties; check what McLeod posted after the close.",
        severity: "critical",
        entityType: "integration",
        entityId: null,
        dedupeKey: `finance:close-changed:${orgId}:${day}`,
      });
    }
  }
  return written;
}
