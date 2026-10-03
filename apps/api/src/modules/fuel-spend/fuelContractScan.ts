/**
 * Nightly contract scan — the producer that gives `contract_variance` a life in `fuel_exceptions`
 * (Q-FSV15 ruling 4, design verdict 2026-10-03).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
 * `contractFindings` was written with the Buy discipline tab's "Paid vs Pilot quote" list and nothing
 * called it, so a fill billed above its quote could be SEEN and never ASSIGNED, evidenced or closed
 * (the verdict's "no action trail from finding to resolution"). The fills are the same ones `readSpendLines`
 * returns; the quote comes from the kept daily Pilot reports (0245/0247), so this needs no uploaded statement.
 *
 * ── WHY THE WINDOW IS THE SCHEDULER'S AND NOT A CALENDAR MONTH ───────────────────────────────────
 * `policyFindings` prices a premium against the month's own baseline, so it must scan whole months. A
 * contract finding compares one fill with its own quote and has no baseline, so the sweep's trailing
 * window is the right unit and is both what is read and what is closed (`p_period_*`). A fill whose quote
 * arrives a day late carries a null contract amount until then, is unmeasurable, and files nothing early.
 *
 * ── WHY THERE IS A FLOOR ─────────────────────────────────────────────────────────────────────────
 * `MIN_CONTRACT_OVERBILL_USD`; the measurement behind it is on `contractFindings`. Without it 1,476 of 3,899
 * quoted fills in 90 days are "overbilled", nearly all by cents. A fill that later falls under the floor
 * (the quote is corrected) is closed `resolved_by_reingest` by the sync, which is the honest record.
 *
 * ── AND ITS CLOSE SCOPE IS ITS OWN ───────────────────────────────────────────────────────────────
 * `CONTRACT_EXCEPTION_KINDS`, passed as `p_kinds` (0253). Org-filtered by `readSpendLines`, which takes
 * the org explicitly because the service role bypasses RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTRACT_EXCEPTION_KINDS,
  MIN_CONTRACT_OVERBILL_USD,
  analyzeContractCapture,
  contractFindings,
} from "@silvicom/shared";
import { readSpendLines } from "./fuelSpendLines.js";

export interface ContractScanResult {
  from: string;
  to: string;
  filed: number;
  inserted: number;
  refreshed: number;
  closed: number;
  error: string | null;
}

export async function runFuelContractScan(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  actorId: string | null = null,
): Promise<ContractScanResult> {
  // No vehicle filter: a finding is about a fill, and narrowing the read would close the others.
  const lines = await readSpendLines(admin, orgId, from, to, []);
  const findings = contractFindings(analyzeContractCapture(lines), MIN_CONTRACT_OVERBILL_USD);
  const base = { from, to, filed: findings.length };

  const { data, error } = await admin.rpc("sync_fuel_exceptions", {
    p_org: orgId,
    p_run: null,
    p_findings: findings,
    p_actor: actorId,
    p_kinds: CONTRACT_EXCEPTION_KINDS,
    p_period_start: from,
    p_period_end: to,
  });
  if (error) return { ...base, inserted: 0, refreshed: 0, closed: 0, error: error.message };

  const row = (Array.isArray(data) ? data[0] : data) as { inserted?: number; refreshed?: number; closed?: number } | null;
  return {
    ...base,
    inserted: Number(row?.inserted ?? 0),
    refreshed: Number(row?.refreshed ?? 0),
    closed: Number(row?.closed ?? 0),
    error: null,
  };
}
