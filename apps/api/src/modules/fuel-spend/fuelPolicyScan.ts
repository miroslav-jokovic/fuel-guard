/**
 * The nightly policy scan — the producer that gives `fuel_exceptions` its rows (C6).
 *
 * ── WHY THIS IS THE LEDGER'S FIRST REAL PRODUCER ─────────────────────────────────────────────────
 * `fuel_exceptions` shipped in 0250 with eight kinds and, measured on production 2026-09-05, ONE row.
 * Its only wired producer is `reconFindings`, which cannot fire until somebody uploads a vendor
 * statement, and `fuel_statements` is still empty after eight months. This one reads the EFS feed
 * instead — ~14,800 rows for this carrier — so the ledger stops depending on an onboarding step nobody
 * has taken.
 *
 * ── WHY IT SCANS WHOLE MONTHS AND NOT THE ROLLUP'S TRAILING FORTNIGHT ────────────────────────────
 * `policyFindings` prices a premium against what the rest of the fleet paid over the same lines, and
 * that baseline is only the month's if the input IS the month. Handed a fortnight it would score
 * August against two weeks of August, and the next night's run would silently replace the answer with
 * a different one. So the scheduler's window is translated into the CALENDAR MONTHS it touches, and
 * each is scanned whole. At a 14-day rebuild that is one month, or two across a month boundary.
 *
 * The current month is deliberately scanned before it is over. Its findings are month-to-date and get
 * larger as fills post — which is correct and is exactly what D-FX10's fingerprint is for: the same
 * truck-month is the same row, its evidence is refreshed, and a person's status, owner and note are
 * left alone. A truck-month that turns beneficial by the 30th is closed as `resolved_by_reingest`,
 * which is the honest record: nobody decided anything, it stopped being a finding.
 *
 * ── WHY IT PASSES A PERIOD RATHER THAN A RUN (0320) ──────────────────────────────────────────────
 * `sync_fuel_exceptions` learns a producer's window from `fuel_recon_runs` via `p_run`. A policy scan
 * has no statement, no tolerances and no matcher version, so it has no run — and with a null one the
 * function could file findings and never close any of them, which is the defect 0253 exists to
 * prevent. 0320 lets a producer state its own period; this is the caller that does.
 *
 * `POLICY_EXCEPTION_KINDS` is passed as the close scope and comes from shared, beside the producer
 * that emits it. A literal at this call site is how a producer ends up closing findings it does not own.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  POLICY_EXCEPTION_KINDS,
  monthBounds,
  policyFindings,
  type PolicyExceptionKind,
} from "@silvicom/shared";
import { readFuelPolicy, readSpendLines } from "./fuelSpendLines.js";

export interface PolicyScanResult {
  month: string;
  filed: number;
  inserted: number;
  refreshed: number;
  closed: number;
  /** Excess the grouping could not place on a truck, or that beat the baseline. Per kind, in dollars. */
  unplaced: Record<PolicyExceptionKind, { fills: number; excess: number }>;
  beneficial: Record<PolicyExceptionKind, { groups: number; excess: number }>;
  error: string | null;
}

/**
 * The calendar months a `[from, to]` window touches, oldest first.
 *
 * String arithmetic on `YYYY-MM`, so no clock and no timezone can move a month boundary — the same
 * reason `monthBounds` builds its dates in UTC. Capped at twelve because the only callers are a
 * fortnight-wide scheduler and an explicit backfill, and an unbounded loop here would let a typo in a
 * date range scan a decade of fuel one month at a time.
 */
export function monthsTouched(from: string, to: string, cap = 12): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (let i = 0; i < cap; i += 1) {
    const cur = `${y}-${String(m).padStart(2, "0")}`;
    out.push(cur);
    if (cur >= last) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * Score one calendar month against the org's policy and file what it finds.
 *
 * Best-effort by design, like the reconciliation's own call: a failure here costs the ledger an entry
 * and is reported, rather than stopping the nightly sweep for every other carrier behind it.
 */
export async function runFuelPolicyScan(
  admin: SupabaseClient,
  orgId: string,
  month: string,
  actorId: string | null = null,
): Promise<PolicyScanResult> {
  const bounds = monthBounds(month);
  const [lines, policy] = await Promise.all([
    // No vehicle filter: the policy question is about the whole fleet's month, and narrowing it would
    // also narrow the BASELINE the premium is measured against, which would change every answer.
    readSpendLines(admin, orgId, bounds.start, bounds.end, []),
    readFuelPolicy(admin, orgId),
  ]);

  const res = policyFindings(lines, month, policy);
  const base: Omit<PolicyScanResult, "inserted" | "refreshed" | "closed" | "error"> = {
    month,
    filed: res.findings.length,
    unplaced: res.unattributed,
    beneficial: res.beneficial,
  };

  const { data, error } = await admin.rpc("sync_fuel_exceptions", {
    p_org: orgId,
    // No run: see the header. The period below is what replaces it.
    p_run: null,
    p_findings: res.findings,
    p_actor: actorId,
    p_kinds: POLICY_EXCEPTION_KINDS,
    p_period_start: bounds.start,
    p_period_end: bounds.end,
  });
  if (error) return { ...base, inserted: 0, refreshed: 0, closed: 0, error: error.message };

  const row = (Array.isArray(data) ? data[0] : data) as
    | { inserted?: number; refreshed?: number; closed?: number }
    | null;
  return {
    ...base,
    inserted: Number(row?.inserted ?? 0),
    refreshed: Number(row?.refreshed ?? 0),
    closed: Number(row?.closed ?? 0),
    error: null,
  };
}

/** Scan every calendar month a window touches. Sequential: two scans of one org contend on its rows. */
export async function runFuelPolicyScanForWindow(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  actorId: string | null = null,
): Promise<PolicyScanResult[]> {
  const out: PolicyScanResult[] = [];
  for (const month of monthsTouched(from, to)) {
    out.push(await runFuelPolicyScan(admin, orgId, month, actorId));
  }
  return out;
}
