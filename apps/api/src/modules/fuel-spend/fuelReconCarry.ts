/**
 * The invoice check carries forward what an earlier week left open — the reads and the closes.
 *
 * The decisions are pure and live in shared (`reconcile/fuelReconCarry.ts`, which says why each exists); this
 * file reads the evidence they need and hands their answers to `close_fuel_exceptions` (0647), which closes
 * the named findings with the reason as the event's note and writes one audit row per call.
 *
 * Runs AFTER `sync_fuel_exceptions`, so a finding this run produced again already carries this run's id and
 * is never mistaken for a leftover. Every step is best-effort, like the sync itself: the run is recorded and
 * the reader is looking at it, so a failure here costs a finding its close, never the check.
 *
 * Every read carries its own `.eq("org_id", …)` — the service role bypasses RLS (`expectOrgScoped`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  billedLateFingerprints,
  CARRY_LOOKBACK_DAYS,
  CARRY_NOTES,
  matchedFillIds,
  matchLateRecorded,
  RECON_EXCEPTION_KINDS,
  type OpenUnrecordedFinding,
  type ReconResult,
  type ReconRow,
  type ReconTolerances,
} from "@silvicom/shared";
import { addDays, readSystemFills } from "./reconSystemFills.js";

const OPEN = ["open", "investigating"] as const;

/**
 * Fills another LIVE weekly check already matched to a line — "billed on that invoice". Monthly exports are
 * deliberately not read: an export is a second copy of the same billing, not a bill, so a fill it matched
 * was not thereby billed. `exceptInvoice` leaves out the invoice being checked, whose earlier run is about
 * to be superseded by this one.
 */
export async function readBilledElsewhere(
  admin: SupabaseClient,
  orgId: string,
  range: { from: string; to: string },
  exceptInvoice: string | null,
): Promise<Set<string>> {
  const { data: runs, error } = await admin
    .from("fuel_recon_runs")
    .select("id, invoice_no")
    .eq("org_id", orgId)
    .eq("source_kind", "weekly_statement")
    .is("superseded_by", null)
    .lte("period_start", range.to)
    .gte("period_end", range.from);
  if (error) throw new Error(`could not read earlier checks: ${error.message}`);
  const ids = ((runs ?? []) as Array<{ id: string; invoice_no: string | null }>)
    .filter((r) => !exceptInvoice || r.invoice_no !== exceptInvoice)
    .map((r) => r.id);
  if (ids.length === 0) return new Set();
  const { data: saved, error: rowsErr } = await admin
    .from("fuel_recon_run_rows")
    .select("run_id, rows")
    .eq("org_id", orgId)
    .in("run_id", ids);
  if (rowsErr) throw new Error(`could not read earlier checks' lines: ${rowsErr.message}`);
  const out = new Set<string>();
  for (const s of (saved ?? []) as Array<{ rows: ReconRow[] | null }>) {
    for (const id of matchedFillIds(Array.isArray(s.rows) ? s.rows : [])) out.add(id);
  }
  return out;
}

async function close(
  admin: SupabaseClient,
  orgId: string,
  ctx: { actorId: string | null; runId: string },
  fingerprints: string[],
  kinds: readonly string[],
  note: string,
): Promise<number> {
  if (fingerprints.length === 0) return 0;
  const { data, error } = await admin.rpc("close_fuel_exceptions", {
    p_org: orgId,
    p_fingerprints: [...new Set(fingerprints)],
    p_kinds: kinds,
    p_note: note,
    p_actor: ctx.actorId,
    p_run: ctx.runId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export interface CarryContext {
  runId: string;
  actorId: string | null;
  invoiceNo: string | null;
  window: { from: string; to: string };
  /** Every run this one superseded — a re-check of the same invoice, or the same export bytes. */
  supersededRunIds: string[];
  result: ReconResult;
  tolerances: ReconTolerances;
  maxDayDrift: number;
}

export interface CarryOutcome {
  /** Findings an earlier check of THIS invoice made and this one no longer does. */
  recheckDropped: number;
  /** Unbilled fills from an earlier week that a line on this invoice matched. */
  billedLate: number;
  /** Unrecorded lines from an earlier week whose fill has since been recorded. */
  recordedLate: number;
  error: string | null;
}

export async function carryForward(admin: SupabaseClient, orgId: string, ctx: CarryContext): Promise<CarryOutcome> {
  const out: CarryOutcome = { recheckDropped: 0, billedLate: 0, recordedLate: 0, error: null };
  const errors: string[] = [];

  // ── a re-check closes its own leftovers ──────────────────────────────────────────────────────────
  // The re-check may read a different period than the run it replaces — INV-59656 was first read as
  // 11/16–11/23, re-read as its billing week 11/16–11/22 — so the sync, which closes only inside the period
  // it read, cannot reach a finding the earlier run filed on 11/23. A finding the new run produced again
  // was re-pointed at the new run by the sync, so whatever still names a superseded run is a leftover.
  if (ctx.supersededRunIds.length > 0) {
    try {
      const { data, error } = await admin
        .from("fuel_exceptions")
        .select("fingerprint")
        .eq("org_id", orgId)
        .in("run_id", ctx.supersededRunIds)
        .in("kind", [...RECON_EXCEPTION_KINDS])
        .in("status", [...OPEN]);
      if (error) throw new Error(error.message);
      const fps = ((data ?? []) as Array<{ fingerprint: string }>).map((r) => r.fingerprint);
      out.recheckDropped = await close(admin, orgId, ctx, fps, RECON_EXCEPTION_KINDS, CARRY_NOTES.recheckDropped(ctx.invoiceNo));
    } catch (e) {
      errors.push(`re-check leftovers: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── a fill billed late ──────────────────────────────────────────────────────────────────────────
  try {
    out.billedLate = await close(
      admin, orgId, ctx, billedLateFingerprints(ctx.result, ctx.window), ["recon_missing_on_report"],
      CARRY_NOTES.billedLate(ctx.invoiceNo),
    );
  } catch (e) {
    errors.push(`billed late: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── a fill recorded late ────────────────────────────────────────────────────────────────────────
  try {
    const { data, error } = await admin
      .from("fuel_exceptions")
      .select("fingerprint, occurred_on, evidence")
      .eq("org_id", orgId)
      .eq("kind", "recon_missing_in_system")
      .in("status", [...OPEN])
      .neq("run_id", ctx.runId)
      .gte("occurred_on", addDays(ctx.window.from, -CARRY_LOOKBACK_DAYS));
    if (error) throw new Error(error.message);
    const findings: OpenUnrecordedFinding[] = ((data ?? []) as Array<{ fingerprint: string; occurred_on: string | null; evidence: OpenUnrecordedFinding["evidence"] }>)
      .map((r) => ({ fingerprint: r.fingerprint, occurredOn: r.occurred_on, evidence: r.evidence }));
    const dates = findings.map((f) => f.occurredOn).filter((d): d is string => d != null).sort();
    if (dates.length > 0) {
      const range = { from: addDays(dates[0]!, -ctx.maxDayDrift), to: addDays(dates[dates.length - 1]!, ctx.maxDayDrift) };
      // This run is live now and its earlier copies are superseded, so "billed elsewhere" here includes the
      // invoice just checked: a fill it matched cannot also close somebody else's unrecorded line.
      const billed = await readBilledElsewhere(admin, orgId, range, null);
      for (const id of matchedFillIds(ctx.result.rows)) billed.add(id);
      const fills = (await readSystemFills(admin, orgId, range.from, range.to)).filter((f) => !billed.has(f.id));
      const matched = matchLateRecorded(findings, fills, { tolerances: ctx.tolerances, maxDayDrift: ctx.maxDayDrift });
      out.recordedLate = await close(
        admin, orgId, ctx, matched.map((m) => m.fingerprint), ["recon_missing_in_system"], CARRY_NOTES.recordedLate(),
      );
    }
  } catch (e) {
    errors.push(`recorded late: ${e instanceof Error ? e.message : String(e)}`);
  }

  out.error = errors.length ? errors.join("; ") : null;
  return out;
}
